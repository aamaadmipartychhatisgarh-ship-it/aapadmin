import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { phoneKey } from "@/lib/phone";
import { ensureWorkerFormSchema } from "@/lib/workerFormSchema";
import { otpMatches, signSession, sessionCookie, MAX_VERIFY_ATTEMPTS } from "@/lib/workerFormAuth";

// POST /api/worker-form/verify-otp  { phone, otp }
// All checks are server-side (§7). On success: mark the OTP used, re-confirm the
// worker is still registered, and issue the signed session cookie.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
const NO_STORE = { "Cache-Control": "no-store" };
const json = (obj, status = 200) => NextResponse.json(obj, { status, headers: NO_STORE });

export async function POST(req) {
  try {
    await ensureWorkerFormSchema();
    const body = await req.json().catch(() => ({}));
    const key = phoneKey(body?.phone);
    const otp = String(body?.otp ?? "").trim();
    if (!key || key.length !== 10) return json({ message: "Please enter a valid phone number." }, 400);
    if (!otp) return json({ message: "Please enter the OTP." }, 400);

    // Newest still-unconsumed challenge for this phone.
    const [row] = await query(
      `SELECT * FROM worker_form_otps WHERE phone = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1`, [key]
    );
    if (!row) return json({ message: "OTP has expired. Please request a new OTP." }, 400);
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return json({ message: "OTP has expired. Please request a new OTP." }, 400);
    }
    if (Number(row.attempts) >= MAX_VERIFY_ATTEMPTS) {
      return json({ message: "Too many attempts. Please request a new OTP." }, 429);
    }
    if (!otpMatches(otp, key, row.otp_hash)) {
      await query(`UPDATE worker_form_otps SET attempts = attempts + 1 WHERE id = ?`, [row.id]);
      return json({ message: "Invalid OTP. Please try again." }, 400);
    }

    // Still a valid registered worker? (source of truth re-check, §7)
    const [worker] = await query(`SELECT id, name, mobile, status FROM workers WHERE id = ?`, [row.worker_id]);
    if (!worker) return json({ message: "You are not registered." }, 403);

    // Single-use: consume the OTP, then issue the session.
    await query(`UPDATE worker_form_otps SET consumed_at = NOW() WHERE id = ?`, [row.id]);
    const token = signSession({ worker_id: worker.id, phone: key });
    const res = json({ ok: true, worker: { name: worker.name, phone: key } });
    res.cookies.set(sessionCookie(token));
    return res;
  } catch (err) {
    console.error("[worker-form] verify-otp error:", err);
    return json({ message: "Could not verify the OTP. Please try again." }, 500);
  }
}
