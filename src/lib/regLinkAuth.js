import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { phoneKey, last10Sql } from "@/lib/phone";
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

// Resolve a registered karyakarta of a campaign by their mobile number. Used by
// the /join (and drive-link) OTP login: the person signing in must already be a
// karyakarta of THIS drive — the same registry the worker links draw on, so no
// new identity source is introduced. Matched on the last 10 digits (numbers are
// stored inconsistently), exactly like the worker dedup rule.
async function resolveCampaignWorker(campaignId, mobile) {
  const key = phoneKey(mobile);
  if (!key || key.length !== 10) return null;
  const [w] = await query(
    `SELECT w.id AS worker_id, w.name AS worker_name, w.mobile AS worker_mobile, w.worker_code
       FROM reg_workers w
      WHERE w.campaign_id = ? AND w.status = 'active' AND ${last10Sql("w.mobile")} = ? LIMIT 1`,
    [campaignId, key]
  );
  return w || null;
}

// Re-resolve a karyakarta by id within an active campaign — used to confirm a
// signed session still maps to an active worker of an active drive.
export async function resolveCampaignWorkerById(campaignId, workerId) {
  if (!campaignId || !workerId) return null;
  const [w] = await query(
    `SELECT w.id AS worker_id, w.name AS worker_name, w.mobile AS worker_mobile, w.worker_code
       FROM reg_workers w JOIN reg_campaigns c ON c.id = w.campaign_id
      WHERE w.id = ? AND w.campaign_id = ? AND w.status = 'active' AND c.status = 'active' LIMIT 1`,
    [workerId, campaignId]
  );
  return w || null;
}

// Resolve any registration entry point to what must be OTP-authenticated:
//   • a worker token         → mode:"worker" (sign in as that link's owner)
//   • a drive public_token   → mode:"drive"  (sign in as any karyakarta of it)
//   • no token (/join)       → mode:"drive"  on the active drive
// Every path is OTP-gated now; there is no anonymous entry.
export async function resolveEntry(token) {
  const t = String(token || "").trim();
  if (t) {
    if (t.length > 64) return null;
    const w = await resolveWorkerLink(t);
    if (w) return { ...w, mode: "worker" };
    const [c] = await query(
      `SELECT id AS campaign_id, name AS campaign_name, status AS campaign_status
         FROM reg_campaigns WHERE public_token = ? LIMIT 1`,
      [t]
    );
    if (c && c.campaign_status === "active") return { mode: "drive", campaign_id: c.campaign_id, campaign_name: c.campaign_name };
    return null;
  }
  const [c] = await query(
    `SELECT id AS campaign_id, name AS campaign_name
       FROM reg_campaigns WHERE status = 'active' ORDER BY created_at DESC, id DESC LIMIT 1`
  );
  if (c) return { mode: "drive", campaign_id: c.campaign_id, campaign_name: c.campaign_name };
  return null;
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
  const tag = `[reg-otp ${String(token || "join").slice(0, 6)}…]`;
  try {
    const entry = await resolveEntry(token);
    if (!entry) {
      console.warn(`${tag} precheck: entry invalid or no open drive`);
      return json({ message: token ? "This registration link is not valid or has been closed." : "Registration is not open right now. Please contact your in-charge." }, 404);
    }
    const entered = phoneKey(body?.mobile);
    if (!entered || entered.length !== 10) {
      return json({ message: "Please enter a valid 10-digit mobile number." }, 400);
    }

    // WHICH number the OTP is sent to. A worker link is bound to one owner; a
    // drive/join login accepts any registered karyakarta of that drive — so the
    // form is never openable by someone who is not already a karyakarta.
    let sendTo;
    if (entry.mode === "worker") {
      const owner = phoneKey(entry.worker_mobile);
      if (!owner || owner.length !== 10) {
        console.error(`${tag} precheck: link has no valid owner mobile (worker_id=${entry.worker_id})`);
        return json({ message: "This registration link does not have a registered mobile number on file yet." }, 409);
      }
      if (entered !== owner) {
        console.warn(`${tag} precheck: entered ${maskPhone(entered)} is not the registered link owner`);
        return json({ message: "This mobile number is not the one registered for this link. Please use the number given to your in-charge." }, 403);
      }
      sendTo = owner;
    } else {
      const w = await resolveCampaignWorker(entry.campaign_id, entered);
      if (!w) {
        console.warn(`${tag} precheck: ${maskPhone(entered)} is not a karyakarta of drive ${entry.campaign_id}`);
        return json({ message: "This mobile number is not registered as a karyakarta for this drive. Please use the number given to your in-charge." }, 403);
      }
      sendTo = entered;
    }

    if (!(await otpConfigured())) {
      console.error(`${tag} no SMS provider configured`);
      return json({ message: "Mobile verification is not available right now. Please contact your in-charge." }, 503);
    }
    // Only now, with the number confirmed as a karyakarta, does an SMS get spent.
    // requestOtp applies the shared rate limits and reuses a still-live code
    // rather than buying a second one.
    const sent = await requestOtp({ mobile: sendTo, campaignId: entry.campaign_id, ip: null });
    if (!sent.ok) {
      console.warn(`${tag} otp send refused: ${sent.message}`);
      return json({ message: sent.message }, sent.status || 502);
    }
    console.log(`${tag} otp sent to ${maskPhone(sendTo)}${sent.reused ? " (reused live code)" : ""}`);
    return json({ ok: true, phone: maskPhone(sendTo), ttlMinutes: sent.ttlMinutes });
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
  const tag = `[reg-otp ${String(token || "join").slice(0, 6)}…]`;
  try {
    const entry = await resolveEntry(token);
    if (!entry) return json({ message: "This registration link is not valid or has been closed." }, 404);

    const code = String(body?.otp ?? body?.code ?? "").trim();
    if (!code) return json({ message: "Please enter the code you received." }, 400);

    // The number the code is verified against, and the karyakarta the session
    // will belong to, are BOTH re-derived server-side — never trusted from the
    // request — so a code sent to one phone can never open another link/drive.
    let verifyMobile, worker;
    if (entry.mode === "worker") {
      const owner = phoneKey(entry.worker_mobile);
      if (!owner || owner.length !== 10) {
        return json({ message: "This registration link does not have a registered mobile number on file yet." }, 409);
      }
      verifyMobile = owner;
      worker = { worker_id: entry.worker_id, worker_name: entry.worker_name, worker_code: entry.worker_code };
    } else {
      const entered = phoneKey(body?.mobile);
      const w = entered ? await resolveCampaignWorker(entry.campaign_id, entered) : null;
      if (!w) {
        return json({ message: "This mobile number is not registered as a karyakarta for this drive." }, 403);
      }
      verifyMobile = entered;
      worker = w;
    }

    const res = await checkOtp({ mobile: verifyMobile, code, ip: null });
    if (!res.ok) {
      console.warn(`${tag} otp verify rejected: ${res.message}`);
      return json({ message: res.message }, res.status || 401);
    }

    // The session is bound to the karyakarta + campaign. A worker link also pins
    // its token; a drive/join session carries no token and is validated by cid.
    const payload = { kind: "reg_link", rwid: worker.worker_id, cid: entry.campaign_id, token: token ? String(token) : null, mobile: verifyMobile, iat: Date.now(), exp: Date.now() + SESSION_TTL_MS };
    const out = json({ ok: true, handler: { name: worker.worker_name, mobile: verifyMobile, worker_code: worker.worker_code } });
    out.cookies.set(regSessionCookie(signPayload(payload)));
    console.log(`${tag} otp verify OK → handler session issued (rwid=${worker.worker_id})`);
    return out;
  } catch (err) {
    console.error(`${tag} otp verify FAILED: ${err?.message || err}`);
    return json({ message: "Unable to verify the code right now. Please try again." }, 500);
  }
}



// GET session state for the form: whether this link needs OTP, and if so whether
// the caller is already verified (+ the handler identity to show).
export async function handleRegSession(req, token) {
  const entry = await resolveEntry(token);
  // No open drive / invalid token → nothing to open. The form's own bootstrap
  // returns the "not open" screen; the gate has no karyakarta to authenticate.
  if (!entry) return json({ required: false });

  if (entry.mode === "worker") {
    const s = readRegSession(req, token);
    if (s && String(s.rwid) === String(entry.worker_id)) {
      return json({ required: true, authenticated: true, handler: { name: entry.worker_name, mobile: maskPhone(phoneKey(entry.worker_mobile)), worker_code: entry.worker_code } });
    }
    return json({ required: true, authenticated: false });
  }

  // Drive / join: OTP is ALWAYS required now (no anonymous access). Authenticated
  // only when the session is a valid karyakarta login for THIS campaign.
  const s = readRegSession(req, null);
  if (s && s.rwid && String(s.cid) === String(entry.campaign_id)) {
    const w = await resolveCampaignWorkerById(entry.campaign_id, s.rwid);
    if (w) {
      return json({ required: true, authenticated: true, handler: { name: w.worker_name, mobile: maskPhone(phoneKey(w.worker_mobile)), worker_code: w.worker_code } });
    }
  }
  return json({ required: true, authenticated: false });
}
