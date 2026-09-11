import { maskPhone } from "@/lib/workerFormAuth";
import { getSettings } from "@/lib/appSettings";

// OTP delivery. The OTP is generated + hashed + stored by the caller; this module
// only DELIVERS the plaintext to the phone, and it NEVER returns the OTP to the
// client, nor logs it or any secret. Configuration is resolved from TWO sources,
// server-side only (§8):
//
//   1. process.env  (preferred — a real secret store)
//   2. the app_settings table  (fallback for hosts where setting env vars is
//      impractical; the value is set once via SQL / a script and read at runtime)
//
// For each key below, env wins; otherwise the DB value is used.
//
//   OTP_SMS_PROVIDER = msg91 | fast2sms | generic   (unset → not configured)
//   MSG91:    MSG91_AUTHKEY, MSG91_TEMPLATE_ID, [MSG91_OTP_VAR=otp], [MSG91_SENDER]
//   Fast2SMS: FAST2SMS_API_KEY, [FAST2SMS_ROUTE=otp], [FAST2SMS_SENDER_ID]
//   generic:  OTP_SMS_URL (with {mobile}/{mobile91}/{otp} placeholders),
//             [OTP_SMS_METHOD=GET], [OTP_SMS_HEADERS as JSON], [OTP_SMS_BODY]
//
// Returns one of:
//   { status: "delivered" }      provider accepted the request
//   { status: "failed", error }  provider rejected / network error
//   { status: "debug" }          no provider, dev/WF_OTP_DEBUG — OTP logged server-side ONLY
//   { status: "unconfigured" }   no provider anywhere, in production
//
// The number handed in is ALWAYS 10 digits (callers pass phoneKey output), so
// building 91XXXXXXXXXX can never double the country code (§4).

const TIMEOUT_MS = 10000;

const CONFIG_KEYS = [
  "OTP_SMS_PROVIDER",
  "MSG91_AUTHKEY", "MSG91_TEMPLATE_ID", "MSG91_OTP_VAR", "MSG91_SENDER",
  "FAST2SMS_API_KEY", "FAST2SMS_ROUTE", "FAST2SMS_SENDER_ID",
  "OTP_SMS_URL", "OTP_SMS_METHOD", "OTP_SMS_HEADERS", "OTP_SMS_BODY",
];

// Merge env + DB config. Env value wins; an empty/absent env value falls back to
// the DB row. Every value is trimmed so a stray space/newline pasted into a panel
// or SQL cell can never corrupt an auth header or provider name.
async function loadSmsConfig() {
  let db = {};
  try {
    db = await getSettings(CONFIG_KEYS);
  } catch (e) {
    console.error("[otp] could not read app_settings:", e?.message || e);
  }
  const cfg = {};
  for (const k of CONFIG_KEYS) {
    const v = process.env[k] || db[k] || "";
    cfg[k] = typeof v === "string" ? v.trim() : v;
  }
  return cfg;
}

async function timedFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// --- MSG91 (Flow API — sends OUR otp as a template variable) ----------------
async function sendMsg91(ten, otp, cfg) {
  const authkey = cfg.MSG91_AUTHKEY;
  const templateId = cfg.MSG91_TEMPLATE_ID;
  if (!authkey || !templateId) return { status: "failed", error: "MSG91_AUTHKEY / MSG91_TEMPLATE_ID not set" };
  const varName = cfg.MSG91_OTP_VAR || "otp";
  const body = {
    template_id: templateId,
    short_url: 0,
    recipients: [{ mobiles: `91${ten}`, [varName]: otp }],
  };
  if (cfg.MSG91_SENDER) body.sender = cfg.MSG91_SENDER;
  const r = await timedFetch("https://control.msg91.com/api/v5/flow/", {
    method: "POST",
    headers: { "Content-Type": "application/json", authkey },
    body: JSON.stringify(body),
  });
  const text = await r.text().catch(() => "");
  let data; try { data = JSON.parse(text); } catch { data = null; }
  // MSG91 replies { type: "success" | "error", message }.
  if (r.ok && data?.type === "success") return { status: "delivered" };
  return { status: "failed", error: `MSG91 ${r.status}: ${data?.message || text || "rejected"}` };
}

// --- Fast2SMS (OTP route — 10-digit number, no country code) ----------------
async function sendFast2Sms(ten, otp, cfg) {
  const apiKey = cfg.FAST2SMS_API_KEY;
  if (!apiKey) return { status: "failed", error: "FAST2SMS_API_KEY not set" };
  const route = cfg.FAST2SMS_ROUTE || "otp";
  const params = new URLSearchParams({ route, variables_values: otp, numbers: ten });
  if (route !== "otp" && cfg.FAST2SMS_SENDER_ID) params.set("sender_id", cfg.FAST2SMS_SENDER_ID);
  const r = await timedFetch("https://www.fast2sms.com/dev/bulkV2", {
    method: "POST",
    headers: { authorization: apiKey, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const text = await r.text().catch(() => "");
  let data; try { data = JSON.parse(text); } catch { data = null; }
  // Fast2SMS signals success with return:true (occasionally as the string "true").
  const ok = data?.return === true || data?.return === "true";
  if (r.ok && ok) return { status: "delivered" };
  // message can be a string or an array of strings — normalise for the log.
  const msg = Array.isArray(data?.message) ? data.message.join("; ") : (data?.message || text || "rejected");
  return { status: "failed", error: `Fast2SMS ${r.status}: ${msg}` };
}

// --- Generic HTTP (any provider, via a URL/body template) -------------------
async function sendGeneric(ten, otp, cfg) {
  const urlTpl = cfg.OTP_SMS_URL;
  if (!urlTpl) return { status: "failed", error: "OTP_SMS_URL not set" };
  const fill = (s) => String(s)
    .replaceAll("{mobile}", ten)
    .replaceAll("{mobile91}", `91${ten}`)
    .replaceAll("{otp}", otp);
  const method = (cfg.OTP_SMS_METHOD || "GET").toUpperCase();
  let headers = { };
  try { if (cfg.OTP_SMS_HEADERS) headers = JSON.parse(cfg.OTP_SMS_HEADERS); } catch { /* ignore bad JSON */ }
  const opts = { method, headers };
  if (method !== "GET" && cfg.OTP_SMS_BODY) opts.body = fill(cfg.OTP_SMS_BODY);
  const r = await timedFetch(fill(urlTpl), opts);
  const text = await r.text().catch(() => "");
  if (r.ok) return { status: "delivered" };
  return { status: "failed", error: `SMS gateway ${r.status}: ${text || "rejected"}` };
}

export async function sendOtpSms(phoneKeyVal, otp) {
  const ten = String(phoneKeyVal || "").replace(/\D/g, "").slice(-10);
  const cfg = await loadSmsConfig();
  const provider = (cfg.OTP_SMS_PROVIDER || "").toLowerCase();

  if (provider) {
    if (ten.length !== 10) return { status: "failed", error: "invalid destination number" };
    try {
      let res;
      if (provider === "msg91") res = await sendMsg91(ten, otp, cfg);
      else if (provider === "fast2sms") res = await sendFast2Sms(ten, otp, cfg);
      else if (provider === "generic") res = await sendGeneric(ten, otp, cfg);
      else res = { status: "failed", error: `unknown OTP_SMS_PROVIDER "${provider}"` };
      // Log the REAL provider error server-side (never the OTP) so failures are
      // diagnosable instead of hidden behind a false "sent" (§2, §8).
      if (res.status !== "delivered") console.error(`[otp] send failed to ${maskPhone(ten)}: ${res.error}`);
      return res;
    } catch (e) {
      console.error(`[otp] send error to ${maskPhone(ten)}: ${e?.message || e}`);
      return { status: "failed", error: e?.message || "network error" };
    }
  }

  // No provider configured (neither env nor app_settings). In dev (or with
  // WF_OTP_DEBUG=1) log the OTP so the flow can be tested; in production, report
  // it as not configured rather than pretending an SMS went out.
  const debug = process.env.WF_OTP_DEBUG === "1" || process.env.NODE_ENV !== "production";
  if (debug) {
    console.log(`[otp] (no SMS provider) OTP for +91${ten} = ${otp}`);
    return { status: "debug" };
  }
  // A clear, actionable SERVER-SIDE configuration error (§4). The diagnostic names
  // which config the RUNNING process can actually see — the non-secret provider
  // value plus set/MISSING booleans (never a key's value) — so the log pinpoints
  // the gap without exposing secrets. "seen" reflects the merged env+DB config.
  const seen = (n) => (cfg[n] ? "set" : "MISSING");
  console.error(
    "[otp] BLOCKED — no SMS provider is configured (checked both env vars and the app_settings table), " +
    `so no OTP can be delivered. Set OTP_SMS_PROVIDER (msg91 | fast2sms | generic) + credentials via either channel. Destination ${maskPhone(ten)}. ` +
    `config seen → OTP_SMS_PROVIDER="${cfg.OTP_SMS_PROVIDER || ""}" ` +
    `FAST2SMS_API_KEY=${seen("FAST2SMS_API_KEY")} MSG91_AUTHKEY=${seen("MSG91_AUTHKEY")} MSG91_TEMPLATE_ID=${seen("MSG91_TEMPLATE_ID")} OTP_SMS_URL=${seen("OTP_SMS_URL")}`
  );
  return { status: "unconfigured" };
}
