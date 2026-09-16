import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { phoneKey } from "@/lib/phone";
import { signPayload, verifySessionToken, maskPhone, SESSION_TTL_MS } from "@/lib/workerFormAuth";
import { requestOtp, checkOtp, otpConfigured } from "@/lib/registrationOtp";

// Phone gate for a WORKER Generate Link (/r/<token>). The mobile verified here is
// the LINK OWNER's (the karyakarta / registration handler), validated against
// reg_workers.mobile for THIS token — never the worker being added. A verified
// handler gets a session cookie BOUND TO THIS TOKEN, so every worker they then
// submit is attributed to that reg_worker + campaign server-side, and switching
// the URL to another token requires re-authenticating for it (§17, §18).
//
// OTP delivery + verification go through 2Factor (see lib/sms2factor.js). This
// backend still never generates, stores or compares the code itself — 2Factor
// does both, and only its opaque session id is kept — but it does now own the
// send, which means the owner pre-check below matters more than ever: a wrong
// number is rejected BEFORE any SMS is spent, and the per-number and per-IP
// limits in lib/registrationOtp.js apply to this gate exactly as they do to the
// public form, because both spend the same prepaid balance.

const REG_COOKIE = "reg_link_session";
const NO_STORE = { "Cache-Control": "no-store" };
const json = (obj, status = 200) => NextResponse.json(obj, { status, headers: NO_STORE });

// Resolve a token to its worker link (both worker + campaign active). Returns
// null for a drive/general/invalid token — those are NOT OTP-gated.
export async function resolveWorkerLink(token) {
  const t = String(token || "").trim();
  if (!t || t.length > 64) return null;
  const [row] = await query(
    `SELECT w.id AS worker_id, w.name AS worker_name, w.mobile AS worker_mobile, w.worker_code,
            w.status AS worker_status, c.id AS campaign_id, c.status AS campaign_status
       FROM reg_workers w JOIN reg_campaigns c ON c.id = w.campaign_id
      WHERE w.token = ? LIMIT 1`,
    [t]
  );
  if (!row) return null;
  if (row.worker_status !== "active" || row.campaign_status !== "active") return null;
  return row;
}

// --- session cookie (bound to one link token) ------------------------------
export function regSessionCookie(value, { clear = false } = {}) {
  return {
    name: REG_COOKIE, value: clear ? "" : value,
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: clear ? 0 : Math.floor(SESSION_TTL_MS / 1000),
  };
}
// Verify the cookie AND that it is bound to this exact token → the handler's
// reg_worker id, or null. Never trusts a client-supplied worker/link id.
export function readRegSession(req, token) {
  const raw = req?.cookies?.get?.(REG_COOKIE)?.value;
  const p = verifySessionToken(raw);
  if (!p || p.kind !== "reg_link" || !p.rwid) return null;
  if (token != null && String(p.token) !== String(token)) return null;
  return p; // { kind, rwid, cid, token, mobile, exp }
}

// --- Owner check, then send the code ---------------------------------------
// The number is checked against reg_workers FIRST, so a wrong number is rejected
// instantly and no SMS is spent on it. Only a confirmed link owner gets a code.
export async function handleRegOtpRequest(token, body) {
  const tag = `[reg-otp ${String(token || "").slice(0, 6)}…]`;
  try {
    const link = await resolveWorkerLink(token);
    if (!link) {
      console.warn(`${tag} precheck: registration token invalid or closed`);
      return json({ message: "This registration link is not valid or has been closed." }, 404);
    }
    const entered = phoneKey(body?.mobile);
    if (!entered || entered.length !== 10) {
      return json({ message: "Please enter a valid 10-digit mobile number." }, 400);
    }
    const owner = phoneKey(link.worker_mobile);
    if (!owner || owner.length !== 10) {
      console.error(`${tag} precheck: link has no valid owner mobile (worker_id=${link.worker_id})`);
      return json({ message: "This registration link does not have a registered mobile number on file yet." }, 409);
    }
    if (entered !== owner) {
      console.warn(`${tag} precheck: entered ${maskPhone(entered)} is not the registered link owner`);
      return json({ message: "This mobile number is not the one registered for this link. Please use the number given to your in-charge." }, 403);
    }
    if (!(await otpConfigured())) {
      console.error(`${tag} no SMS provider configured`);
      return json({ message: "Mobile verification is not available right now. Please contact your in-charge." }, 503);
    }
    // Only now, with the number confirmed as this link's owner, does an SMS get
    // spent. requestOtp applies the shared rate limits and reuses a still-live
    // code rather than buying a second one.
    const sent = await requestOtp({ mobile: entered, campaignId: link.campaign_id, ip: null });
    if (!sent.ok) {
      console.warn(`${tag} otp send refused: ${sent.message}`);
      return json({ message: sent.message }, sent.status || 502);
    }
    console.log(`${tag} otp sent to ${maskPhone(entered)}${sent.reused ? " (reused live code)" : ""}`);
    return json({ ok: true, phone: maskPhone(entered), ttlMinutes: sent.ttlMinutes });
  } catch (err) {
    console.error(`${tag} precheck FAILED: ${err?.message || err}`);
    return json({ message: "Unable to process the request right now. Please try again." }, 500);
  }
}

// --- Verify the code → issue the handler session ---------------------------
// The client sends the code the handler received. 2Factor checks it against the
// session it issued; we never compare it ourselves. A correct code for THIS
// link's owner is what mints the session cookie — the number is re-derived from
// the link here rather than trusted from the request, so a valid code for one
// number can never open another link (§3, §5, §11).
export async function handleRegOtpVerify(token, body) {
  const tag = `[reg-otp ${String(token || "").slice(0, 6)}…]`;
  try {
    const link = await resolveWorkerLink(token);
    if (!link) return json({ message: "This registration link is not valid or has been closed." }, 404);

    const owner = phoneKey(link.worker_mobile);
    if (!owner || owner.length !== 10) {
      return json({ message: "This registration link does not have a registered mobile number on file yet." }, 409);
    }
    const code = String(body?.otp ?? body?.code ?? "").trim();
    if (!code) return json({ message: "Please enter the code you received." }, 400);

    // Verified against the OWNER's number from the link, never a mobile the
    // request supplied — otherwise a code sent to one phone could be replayed
    // against a different link.
    const res = await checkOtp({ mobile: owner, code, ip: null });
    if (!res.ok) {
      console.warn(`${tag} otp verify rejected: ${res.message}`);
      return json({ message: res.message }, res.status || 401);
    }

    const payload = { kind: "reg_link", rwid: link.worker_id, cid: link.campaign_id, token: String(token), mobile: owner, iat: Date.now(), exp: Date.now() + SESSION_TTL_MS };
    const out = json({ ok: true, handler: { name: link.worker_name, mobile: owner, worker_code: link.worker_code } });
    out.cookies.set(regSessionCookie(signPayload(payload)));
    console.log(`${tag} otp verify OK → handler session issued`);
    return out;
  } catch (err) {
    console.error(`${tag} otp verify FAILED: ${err?.message || err}`);
    return json({ message: "Unable to verify the code right now. Please try again." }, 500);
  }
}



// GET session state for the form: whether this link needs OTP, and if so whether
// the caller is already verified (+ the handler identity to show).
export async function handleRegSession(req, token) {
  const link = await resolveWorkerLink(token);
  if (!link) return json({ required: false }); // drive/general/invalid → anonymous flow
  const s = readRegSession(req, token);
  if (s && String(s.rwid) === String(link.worker_id)) {
    return json({ required: true, authenticated: true, handler: { name: link.worker_name, mobile: maskPhone(phoneKey(link.worker_mobile)), worker_code: link.worker_code } });
  }
  return json({ required: true, authenticated: false });
}
