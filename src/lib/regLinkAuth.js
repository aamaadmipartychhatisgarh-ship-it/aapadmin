import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { phoneKey } from "@/lib/phone";
import { signPayload, verifySessionToken, maskPhone, SESSION_TTL_MS } from "@/lib/workerFormAuth";
import { verifyFirebaseIdToken } from "@/lib/firebaseVerify";

// Phone gate for a WORKER Generate Link (/r/<token>). The mobile verified here is
// the LINK OWNER's (the karyakarta / registration handler), validated against
// reg_workers.mobile for THIS token — never the worker being added. A verified
// handler gets a session cookie BOUND TO THIS TOKEN, so every worker they then
// submit is attributed to that reg_worker + campaign server-side, and switching
// the URL to another token requires re-authenticating for it (§17, §18).
//
// OTP delivery + verification is handled ENTIRELY by Firebase Phone Auth on the
// client. This backend never generates, sends, stores, or compares an OTP: it
// (1) pre-checks that the entered number is the link owner's (so a wrong number
// is caught before an SMS is spent), and (2) verifies the Firebase ID token the
// client returns and, if the verified number matches the owner, issues the
// handler session. No SMS provider / API key is involved anywhere.

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

// --- Pre-check: is the entered number this link's owner? (NO SMS) -----------
// Called before the client starts Firebase phone auth, so a wrong number is
// rejected instantly and no Firebase SMS is spent on it. Generates nothing,
// stores nothing, sends nothing (§2, §4). Returns the E.164 number the client
// should verify so the country code is never doubled (§6).
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
    console.log(`${tag} precheck OK → client starts Firebase phone verification`);
    return json({ ok: true, phone: maskPhone(entered), e164: `+91${entered}` });
  } catch (err) {
    console.error(`${tag} precheck FAILED: ${err?.message || err}`);
    return json({ message: "Unable to process the request right now. Please try again." }, 500);
  }
}

// --- Firebase verify → issue the handler session ---------------------------
// The client did Firebase phone auth (Firebase sent + checked the OTP) and hands
// us the resulting ID token. We verify it, read the VERIFIED phone number from
// it, confirm it is this link's owner, and issue the same session cookie the old
// OTP flow used — so every downstream business rule is unchanged (§3, §5, §11).
export async function handleRegFirebaseVerify(token, body) {
  const tag = `[reg-otp ${String(token || "").slice(0, 6)}…]`;
  try {
    const link = await resolveWorkerLink(token);
    if (!link) return json({ message: "This registration link is not valid or has been closed." }, 404);

    const idToken = body?.idToken;
    if (!idToken) return json({ message: "Phone verification is missing. Please verify your number again." }, 400);

    const res = await verifyFirebaseIdToken(idToken);
    if (!res.ok) {
      console.warn(`${tag} firebase verify rejected: ${res.error}`);
      if (res.error === "firebase-not-configured") {
        return json({ message: "Mobile verification is not available right now. Please try again later." }, 503);
      }
      return json({ message: "Could not verify your phone number. Please try again." }, 401);
    }

    const verified = phoneKey(res.phone);
    if (!verified || verified.length !== 10) {
      return json({ message: "Could not read the verified phone number. Please try again." }, 400);
    }
    const owner = phoneKey(link.worker_mobile);
    if (!owner || owner.length !== 10) {
      return json({ message: "This registration link does not have a registered mobile number on file yet." }, 409);
    }
    if (verified !== owner) {
      console.warn(`${tag} firebase-verified ${maskPhone(verified)} is not the registered link owner`);
      return json({ message: "The verified mobile number is not the one registered for this link." }, 403);
    }

    const payload = { kind: "reg_link", rwid: link.worker_id, cid: link.campaign_id, token: String(token), mobile: verified, iat: Date.now(), exp: Date.now() + SESSION_TTL_MS };
    const out = json({ ok: true, handler: { name: link.worker_name, mobile: verified, worker_code: link.worker_code } });
    out.cookies.set(regSessionCookie(signPayload(payload)));
    console.log(`${tag} firebase verify OK → handler session issued`);
    return out;
  } catch (err) {
    console.error(`${tag} firebase verify FAILED: ${err?.message || err}`);
    return json({ message: "Unable to verify the phone right now. Please try again." }, 500);
  }
}

// Backward-compatible alias: the old /otp/verify route now performs Firebase
// verification (body carries { idToken } instead of { otp }).
export const handleRegOtpVerify = handleRegFirebaseVerify;

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
