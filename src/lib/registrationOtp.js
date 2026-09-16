import { query } from "@/lib/db";
import { ensureRegistrationSchema, regNow } from "@/lib/registrationSchema";
import { sendOtp, verifyOtp, smsConfigured } from "@/lib/sms2factor";

// Mobile verification for the public registration form.
//
// Every SMS costs real prepaid credit, and the endpoint that sends them is open
// to the internet — so the limits below are not politeness, they are the only
// thing between a bored script and an exhausted balance that silently stops the
// whole drive. They are enforced in the DATABASE, not process memory, because
// production runs more than one worker and an in-memory counter would reset on
// every deploy and be bypassable by whichever process answered.
const LIMITS = {
  perMobilePerHour: 3,       // a real person needs one, maybe two on a bad signal
  perIpPerHour: 15,          // a household or a karyakarta's phone, not a script
  perIpPerDay: 60,
  maxVerifyAttempts: 5,      // then that session is dead and they request a new code
  codeTtlMinutes: 10,        // how long the SMS'd code stays usable
  verifiedTtlMinutes: 30,    // how long a proven number stays proven while they finish the form
};

const minutesAgo = (n) => `DATE_SUB(NOW(), INTERVAL ${Number(n)} MINUTE)`;

export function otpConfigured() {
  return smsConfigured();
}

// --- Rate limiting ---------------------------------------------------------
// Returns null when the request is allowed, or a message when it is not. The
// messages deliberately tell the person what to do next ("wait an hour") rather
// than exposing the limit, which would just tell a scripter what to stay under.
async function rateLimit(mobile, ip) {
  const [[byMobile]] = [await query(
    `SELECT COUNT(*) AS n FROM reg_otp_sessions WHERE mobile = ? AND created_at > ${minutesAgo(60)}`,
    [mobile]
  )];
  if (Number(byMobile?.n || 0) >= LIMITS.perMobilePerHour) {
    return "Too many codes requested for this number. Please try again in an hour.";
  }
  if (ip) {
    const [[byIpHour]] = [await query(
      `SELECT COUNT(*) AS n FROM reg_otp_sessions WHERE source_ip = ? AND created_at > ${minutesAgo(60)}`,
      [ip]
    )];
    if (Number(byIpHour?.n || 0) >= LIMITS.perIpPerHour) {
      return "Too many codes requested from this device. Please try again later.";
    }
    const [[byIpDay]] = [await query(
      `SELECT COUNT(*) AS n FROM reg_otp_sessions WHERE source_ip = ? AND created_at > ${minutesAgo(60 * 24)}`,
      [ip]
    )];
    if (Number(byIpDay?.n || 0) >= LIMITS.perIpPerDay) {
      return "Too many codes requested from this device today. Please try again tomorrow.";
    }
  }
  return null;
}

// --- Send ------------------------------------------------------------------
// `alreadyRegistered` is checked by the CALLER before we get here: sending a
// code to a number that cannot be registered anyway would waste an SMS and end
// in a dead end for the person.
export async function requestOtp({ mobile, campaignId, ip }) {
  await ensureRegistrationSchema();
  if (!otpConfigured()) {
    return { ok: false, status: 503, message: "Mobile verification is not configured. Please contact your in-charge." };
  }

  const limited = await rateLimit(mobile, ip);
  if (limited) return { ok: false, status: 429, message: limited };

  // Reusing a code that is still alive costs nothing and spares the balance
  // when someone taps "Send" twice on a slow connection.
  const [live] = await query(
    `SELECT id FROM reg_otp_sessions
      WHERE mobile = ? AND verified = 0 AND consumed = 0 AND expires_at > NOW()
        AND created_at > ${minutesAgo(2)}
      ORDER BY id DESC LIMIT 1`,
    [mobile]
  );
  if (live) return { ok: true, reused: true, ttlMinutes: LIMITS.codeTtlMinutes };

  const sent = await sendOtp(mobile);
  if (!sent.ok) {
    // The provider's own words go to the SERVER LOG so an operator can tell
    // "insufficient balance" from "invalid number"; the public sees a neutral
    // message, because provider internals are not the public's business.
    console.error("[registration] OTP send failed:", sent.reason);
    return { ok: false, status: 502, message: "Could not send the code right now. Please try again in a minute." };
  }

  await query(
    `INSERT INTO reg_otp_sessions (mobile, session_id, campaign_id, source_ip, expires_at)
     VALUES (?,?,?,?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [mobile, sent.sessionId, campaignId || null, ip || null, LIMITS.codeTtlMinutes]
  );
  return { ok: true, ttlMinutes: LIMITS.codeTtlMinutes };
}

// --- Verify ----------------------------------------------------------------
export async function checkOtp({ mobile, code, ip }) {
  await ensureRegistrationSchema();
  const digits = String(code || "").replace(/\D/g, "");
  if (digits.length < 4 || digits.length > 8) {
    return { ok: false, status: 400, message: "Enter the code exactly as you received it." };
  }

  const [row] = await query(
    `SELECT id, session_id, attempts FROM reg_otp_sessions
      WHERE mobile = ? AND verified = 0 AND consumed = 0 AND expires_at > NOW()
      ORDER BY id DESC LIMIT 1`,
    [mobile]
  );
  if (!row) {
    return { ok: false, status: 400, message: "That code has expired. Please request a new one." };
  }
  if (Number(row.attempts) >= LIMITS.maxVerifyAttempts) {
    // Burn the session rather than leaving it open to be guessed at forever.
    await query(`UPDATE reg_otp_sessions SET consumed = 1 WHERE id = ?`, [row.id]);
    return { ok: false, status: 429, message: "Too many wrong attempts. Please request a new code." };
  }

  const res = await verifyOtp(row.session_id, digits);
  if (!res.ok) {
    console.error("[registration] OTP verify failed:", res.reason);
    return { ok: false, status: 502, message: "Could not check the code right now. Please try again in a minute." };
  }
  if (!res.matched) {
    await query(`UPDATE reg_otp_sessions SET attempts = attempts + 1 WHERE id = ?`, [row.id]);
    if (res.expired) {
      await query(`UPDATE reg_otp_sessions SET consumed = 1 WHERE id = ?`, [row.id]);
      return { ok: false, status: 400, message: "That code has expired. Please request a new one." };
    }
    const left = Math.max(0, LIMITS.maxVerifyAttempts - (Number(row.attempts) + 1));
    return {
      ok: false, status: 400,
      message: left ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Incorrect code. Please request a new one.",
    };
  }

  await query(
    `UPDATE reg_otp_sessions SET verified = 1, verified_at = ?, attempts = attempts + 1 WHERE id = ?`,
    [regNow(), row.id]
  );
  return { ok: true, validForMinutes: LIMITS.verifiedTtlMinutes };
}

// --- Gate at submit --------------------------------------------------------
// Proof that THIS mobile was verified recently. Taken from the database, never
// from a flag the client sends: a client-side "verified: true" would make the
// whole thing decorative.
export async function isMobileVerified(mobile) {
  await ensureRegistrationSchema();
  const [row] = await query(
    `SELECT id FROM reg_otp_sessions
      WHERE mobile = ? AND verified = 1 AND consumed = 0
        AND verified_at > ${minutesAgo(LIMITS.verifiedTtlMinutes)}
      ORDER BY id DESC LIMIT 1`,
    [mobile]
  );
  return row ? row.id : null;
}

// Spend the proof once the registration is saved, so one verification cannot be
// replayed to push through a second person on the same number.
export async function consumeVerification(id) {
  if (!id) return;
  await query(`UPDATE reg_otp_sessions SET consumed = 1 WHERE id = ?`, [id]);
}

export const OTP_LIMITS = LIMITS;
