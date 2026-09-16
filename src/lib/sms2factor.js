// SMS OTP via 2Factor (2factor.in) — the only place this product talks to that
// provider.
//
// Two calls make up the whole flow:
//   AUTOGEN  GET /API/V1/{key}/SMS/+91{phone}/AUTOGEN
//            → { Status: "Success", Details: "<session id>" }
//            2Factor generates and sends the code, so the OTP itself never
//            exists on our side — there is no value for us to leak, log or
//            accidentally return to the client.
//   VERIFY   GET /API/V1/{key}/SMS/VERIFY/{session id}/{code}
//            → { Status: "Success", Details: "OTP Matched" }
//
// The API key lives in TWOFACTOR_API_KEY and is never written to a log line or
// an error message: it is a bearer credential sitting in the URL PATH, so any
// code that echoes a failing URL would publish it. Every error below is built
// from the provider's Details field alone.

import { getSettings } from "@/lib/appSettings";

const BASE = "https://2factor.in/API/V1";
const TIMEOUT_MS = 12000;

// Credentials come from the environment when it has them, and otherwise from
// app_settings — the browser-configurable store. That fallback exists because on
// this host setting env vars means a full-replace API over masked values, where
// one wrong entry breaks admin login; configuring the key from the Integrations
// page avoids touching the deployed environment at all. Env still wins, so a
// host that CAN set variables is never overridden by a stale database row.
const SETTING_KEYS = ["TWOFACTOR_API_KEY", "TWOFACTOR_SMS_TEMPLATE"];
let cache = { at: 0, values: {} };
const CACHE_MS = 30000;

async function settings() {
  if (Date.now() - cache.at < CACHE_MS) return cache.values;
  let values = {};
  try { values = await getSettings(SETTING_KEYS); } catch { values = cache.values || {}; }
  cache = { at: Date.now(), values };
  return values;
}
// Called after a save so the console reflects the new key immediately rather
// than up to CACHE_MS later.
export function invalidateSmsConfig() { cache = { at: 0, values: {} }; }

async function resolvedKey() {
  const env = (process.env.TWOFACTOR_API_KEY || "").trim();
  if (env) return env;
  return ((await settings()).TWOFACTOR_API_KEY || "").trim();
}
async function resolvedTemplate() {
  const env = (process.env.TWOFACTOR_SMS_TEMPLATE || "").trim();
  if (env) return env;
  return ((await settings()).TWOFACTOR_SMS_TEMPLATE || "").trim();
}

// Optional DLT-approved template name, appended to the AUTOGEN path.
//
// Without one, 2Factor sends under the account default — and in India an OTP SMS
// is only delivered if it goes out under a DLT-registered header and template.
// A send that fails that check is still BILLED, and an account with voice
// fallback enabled then places a call instead, which looks exactly like "the API
// ignored me and rang the phone". Naming an approved template is what pins
// delivery to SMS. Kept in env so it can be corrected without a code change.


export async function smsConfigured() {
  return !!(await resolvedKey());
}

// Strip the key from anything we are about to log or return, belt and braces.
function scrub(text, key) {
  const s = String(text ?? "");
  return key ? s.split(key).join("<api-key>") : s;
}

async function call(path, key) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/${key}/${path}`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { Status: "Error", Details: scrub(text, key).slice(0, 200) }; }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// Ask 2Factor to generate and send a code. Returns { ok, sessionId } or
// { ok: false, reason } — `reason` is the provider's own message, which is what
// distinguishes "out of balance" from "invalid number" when a drive stops
// working at 9pm and somebody has to work out why.
export async function sendOtp(mobile10) {
  const key = await resolvedKey();
  if (!key) return { ok: false, reason: "No 2Factor API key configured" };
  try {
    const tpl = await resolvedTemplate();
    const body = await call(`SMS/+91${mobile10}/AUTOGEN${tpl ? `/${encodeURIComponent(tpl)}` : ""}`, key);
    if (String(body?.Status).toLowerCase() === "success" && body?.Details) {
      return { ok: true, sessionId: String(body.Details) };
    }
    return { ok: false, reason: scrub(body?.Details, key) || "Unknown provider error" };
  } catch (e) {
    // AbortError included — a provider timeout is an outage, not a bad number.
    return { ok: false, reason: e?.name === "AbortError" ? "Provider timed out" : scrub(e?.message, key) };
  }
}

// Check a code against its session. A wrong code is a NORMAL outcome, not an
// error — it comes back { ok: true, matched: false } so the caller can count the
// attempt rather than treat it as a provider failure.
export async function verifyOtp(sessionId, code) {
  const key = await resolvedKey();
  if (!key) return { ok: false, reason: "No 2Factor API key configured" };
  try {
    const body = await call(`SMS/VERIFY/${encodeURIComponent(sessionId)}/${encodeURIComponent(code)}`, key);
    const status = String(body?.Status).toLowerCase();
    if (status === "success") return { ok: true, matched: true };
    const reason = scrub(body?.Details, key) || "";
    // The provider reports a mismatch and an expired session both as Status:
    // Error; only the text distinguishes them.
    const expired = /expire/i.test(reason);
    return { ok: true, matched: false, expired, reason };
  } catch (e) {
    return { ok: false, reason: e?.name === "AbortError" ? "Provider timed out" : scrub(e?.message, key) };
  }
}

// Remaining SMS credits, for the admin console. Returns null when the provider
// cannot be reached — the caller shows "unknown" rather than a scary zero.
export async function smsBalance() {
  const key = await resolvedKey();
  if (!key) return null;
  try {
    const body = await call("BAL/SMS", key);
    if (String(body?.Status).toLowerCase() === "success") {
      const v = Array.isArray(body.Details) ? body.Details[0] : body.Details;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  } catch {
    return null;
  }
}
