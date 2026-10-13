// PURE verify core for the worker-form Phone + OTP login — no framework imports,
// the DB `query` and the hash comparer are injected, so it runs under `node --test`.
//
// Concurrency-safe by construction (CTA-WF-002 in docs/CTA_REGISTRY.md):
//  1. An attempt is RESERVED with a single conditional UPDATE before the OTP is
//     compared, so N parallel guesses can never all read attempts=0 and bypass
//     the MAX_VERIFY_ATTEMPTS lockout (brute-force via parallel requests).
//  2. The OTP is CONSUMED with a conditional UPDATE (`consumed_at IS NULL`), so
//     two parallel correct submissions cannot both mint a session (replay).
//
// Returns { status, message } on failure or { ok: true, row } on success.
export async function verifyOtpChallenge({ query, otpMatches, key, otp, maxAttempts, now = Date.now() }) {
  const expired = { status: 400, message: "OTP has expired. Please request a new OTP." };

  // Newest still-unconsumed challenge for this phone.
  const [row] = await query(
    `SELECT * FROM worker_form_otps WHERE phone = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1`, [key]
  );
  if (!row) return expired;
  if (new Date(row.expires_at).getTime() < now) return expired;

  const reserved = await query(
    `UPDATE worker_form_otps SET attempts = attempts + 1 WHERE id = ? AND consumed_at IS NULL AND attempts < ?`,
    [row.id, maxAttempts]
  );
  // No row updated → the attempt budget is spent (or a parallel request just
  // consumed it); either way the only way forward is a fresh OTP.
  if (!reserved?.affectedRows) return { status: 429, message: "Too many attempts. Please request a new OTP." };

  if (!otpMatches(otp, key, row.otp_hash)) {
    return { status: 400, message: "Invalid OTP. Please try again." };
  }

  const consumed = await query(
    `UPDATE worker_form_otps SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL`, [row.id]
  );
  if (!consumed?.affectedRows) return expired; // a parallel request already used it
  return { ok: true, row };
}
