import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { normalizeMobile } from "@/lib/registrationSchema";
import { ensureWorkerFormSchema } from "@/lib/workerFormSchema";
import {
  generateOtp, hashOtp, otpMatches, signPayload, verifySessionToken, maskPhone,
  OTP_LENGTH, OTP_TTL_MS, MAX_VERIFY_ATTEMPTS, RESEND_COOLDOWN_MS, MAX_OTP_PER_HOUR, SESSION_TTL_MS,
} from "@/lib/workerFormAuth";
import { sendOtpSms } from "@/lib/otpSender";

// OTP gate for a WORKER Generate Link (/r/<token>). The mobile entered here is
// the LINK OWNER's (the karyakarta / registration handler), validated against
// reg_workers.mobile for THIS token — never the worker being added. A verified
// handler gets a session cookie BOUND TO THIS TOKEN, so every worker they then
// submit is attributed to that reg_worker + campaign server-side, and switching
// the URL to another token requires re-authenticating for it (§17, §18).
//
// Reuses the existing OTP primitives + store (worker_form_otps, scope 'reg_link')
// and the pluggable sender — no second OTP system.

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

// --- OTP request (also serves resend) --------------------------------------
export async function handleRegOtpRequest(token, body) {
  await ensureWorkerFormSchema();
  const link = await resolveWorkerLink(token);
  if (!link) return json({ message: "This registration link is not valid or has been closed." }, 404);

  const entered = normalizeMobile(body?.mobile);
  if (!entered) return json({ message: "Please enter a valid 10-digit mobile number." }, 400);
  const owner = normalizeMobile(link.worker_mobile);
  // The mobile must be the LINK OWNER's registered number (§3, §4).
  if (!owner || entered !== owner) return json({ message: "You are not registered." }, 403);

  // Rate limiting, scoped to this link.
  const [{ recent }] = await query(
    `SELECT COUNT(*) AS recent FROM worker_form_otps WHERE scope='reg_link' AND ref_token=? AND created_at > (NOW() - INTERVAL 1 HOUR)`,
    [token]
  );
  if (Number(recent) >= MAX_OTP_PER_HOUR) return json({ message: "Too many OTP requests. Please try again later." }, 429);
  const [{ last_ts }] = await query(
    `SELECT UNIX_TIMESTAMP(MAX(created_at)) AS last_ts FROM worker_form_otps WHERE scope='reg_link' AND ref_token=?`, [token]
  );
  if (last_ts && Date.now() - Number(last_ts) * 1000 < RESEND_COOLDOWN_MS) {
    return json({ message: "Please wait a few seconds before requesting another OTP." }, 429);
  }

  // Only the newest OTP for this link stays live.
  await query(`UPDATE worker_form_otps SET consumed_at = NOW() WHERE scope='reg_link' AND ref_token=? AND consumed_at IS NULL`, [token]);
  const otp = generateOtp();
  const expires = new Date(Date.now() + OTP_TTL_MS);
  await query(
    `INSERT INTO worker_form_otps (phone, worker_id, otp_hash, expires_at, scope, ref_token) VALUES (?,?,?,?, 'reg_link', ?)`,
    [entered, link.worker_id, hashOtp(otp, entered), expires, token]
  );
  await sendOtpSms(entered, otp); // never echoed to the client

  return json({ ok: true, phone: maskPhone(entered), otpLength: OTP_LENGTH, resendIn: Math.round(RESEND_COOLDOWN_MS / 1000), expiresIn: Math.round(OTP_TTL_MS / 1000) });
}

// --- OTP verify → issue the handler session --------------------------------
export async function handleRegOtpVerify(token, body) {
  await ensureWorkerFormSchema();
  const link = await resolveWorkerLink(token);
  if (!link) return json({ message: "This registration link is not valid or has been closed." }, 404);

  const entered = normalizeMobile(body?.mobile);
  const otp = String(body?.otp ?? "").trim();
  const owner = normalizeMobile(link.worker_mobile);
  if (!entered || entered !== owner) return json({ message: "You are not registered." }, 403);
  if (!otp) return json({ message: "Please enter the OTP." }, 400);

  const [row] = await query(
    `SELECT * FROM worker_form_otps WHERE scope='reg_link' AND ref_token=? AND phone=? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1`,
    [token, entered]
  );
  if (!row) return json({ message: "OTP has expired. Please generate a new OTP." }, 400);
  if (new Date(row.expires_at).getTime() < Date.now()) return json({ message: "OTP has expired. Please generate a new OTP." }, 400);
  if (Number(row.attempts) >= MAX_VERIFY_ATTEMPTS) return json({ message: "Too many attempts. Please generate a new OTP." }, 429);
  if (!otpMatches(otp, entered, row.otp_hash)) {
    await query(`UPDATE worker_form_otps SET attempts = attempts + 1 WHERE id = ?`, [row.id]);
    return json({ message: "Invalid OTP. Please try again." }, 400);
  }
  await query(`UPDATE worker_form_otps SET consumed_at = NOW() WHERE id = ?`, [row.id]);

  const payload = { kind: "reg_link", rwid: link.worker_id, cid: link.campaign_id, token: String(token), mobile: entered, iat: Date.now(), exp: Date.now() + SESSION_TTL_MS };
  const res = json({ ok: true, handler: { name: link.worker_name, mobile: entered, worker_code: link.worker_code } });
  res.cookies.set(regSessionCookie(signPayload(payload)));
  return res;
}

// GET session state for the form: whether this link needs OTP, and if so whether
// the caller is already verified (+ the handler identity to show).
export async function handleRegSession(req, token) {
  await ensureWorkerFormSchema();
  const link = await resolveWorkerLink(token);
  if (!link) return json({ required: false }); // drive/general/invalid → anonymous flow
  const s = readRegSession(req, token);
  if (s && String(s.rwid) === String(link.worker_id)) {
    return json({ required: true, authenticated: true, handler: { name: link.worker_name, mobile: maskPhone(normalizeMobile(link.worker_mobile)), worker_code: link.worker_code } });
  }
  return json({ required: true, authenticated: false });
}
