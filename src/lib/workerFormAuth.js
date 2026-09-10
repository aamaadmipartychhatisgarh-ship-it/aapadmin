import crypto from "crypto";

// Auth primitives for the public "Vote & Registration — Worker Form".
//
// Workers are the registry (a phone is "registered" iff it exists in the
// `workers` table). Authentication is Phone + OTP: the OTP is generated, hashed,
// and stored server-side; on success a signed, httpOnly session cookie is issued
// carrying only the verified worker id + normalized phone. Every protected
// endpoint re-derives the worker from that cookie and re-reads the name/phone
// from `workers` — the frontend is never trusted for identity (§8, §12, §20, §25).
//
// No new dependency: the session token is a compact HMAC-signed token built with
// Node crypto, signed with NEXTAUTH_SECRET (the app's existing secret).

export const WF_COOKIE = "wf_session";
export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60 * 1000;         // OTP valid 5 minutes
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // form session 2 hours
export const MAX_VERIFY_ATTEMPTS = 5;             // wrong-OTP tries before lockout
export const RESEND_COOLDOWN_MS = 30 * 1000;      // min gap between OTP sends
export const MAX_OTP_PER_HOUR = 5;                // per phone

function secret() {
  return (
    process.env.NEXTAUTH_SECRET ||
    process.env.WORKER_FORM_SECRET ||
    "wf-insecure-dev-secret-set-NEXTAUTH_SECRET"
  );
}

const b64urlJson = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const hmac = (body) => crypto.createHmac("sha256", secret()).update(body).digest("base64url");

// --- session token (HMAC-signed, self-contained) ---------------------------
export function signSession({ worker_id, phone }) {
  const payload = { wid: worker_id, phone, iat: Date.now(), exp: Date.now() + SESSION_TTL_MS };
  const body = b64urlJson(payload);
  return `${body}.${hmac(body)}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== "string") return null;
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expect = hmac(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return null; }
  if (!payload?.exp || Date.now() > payload.exp) return null; // expired session → re-auth (§21)
  return payload; // { wid, phone, iat, exp }
}

// Read + verify the worker-form session cookie off a NextRequest.
export function readWorkerSession(req) {
  const token = req?.cookies?.get?.(WF_COOKIE)?.value;
  return verifySessionToken(token);
}

// ResponseCookie descriptor for setting/clearing the session.
export function sessionCookie(value, { clear = false } = {}) {
  return {
    name: WF_COOKIE,
    value: clear ? "" : value,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: clear ? 0 : Math.floor(SESSION_TTL_MS / 1000),
  };
}

// --- OTP -------------------------------------------------------------------
export function generateOtp() {
  let s = "";
  for (let i = 0; i < OTP_LENGTH; i++) s += crypto.randomInt(0, 10);
  return s;
}
// Store only a keyed hash of the OTP (never plaintext) — §18.
export function hashOtp(otp, phoneKeyVal) {
  return crypto.createHmac("sha256", secret()).update(`${phoneKeyVal}:${otp}`).digest("hex");
}
export function otpMatches(otp, phoneKeyVal, storedHash) {
  const h = hashOtp(otp, phoneKeyVal);
  const a = Buffer.from(h);
  const b = Buffer.from(String(storedHash || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Mask a phone for display: reveal only the last 4 digits.
export function maskPhone(phoneKeyVal) {
  const k = String(phoneKeyVal || "").replace(/\D/g, "").slice(-10);
  if (k.length !== 10) return "+91 XXXXX XXXXX";
  return `+91 XXXXXX ${k.slice(6)}`;
}
