import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { phoneKey, last10Sql } from "@/lib/phone";
import { ensureWorkerFormSchema } from "@/lib/workerFormSchema";
import {
  generateOtp, hashOtp, maskPhone, OTP_LENGTH, OTP_TTL_MS,
  RESEND_COOLDOWN_MS, MAX_OTP_PER_HOUR,
} from "@/lib/workerFormAuth";
import { sendOtpSms } from "@/lib/otpSender";

// Shared handler for request-otp AND resend-otp so the security rules
// (registered-check → rate-limit → invalidate previous → generate/send) can
// never drift apart. An OTP is issued ONLY for a phone that exists in `workers`;
// unregistered → 403 with no OTP (§2, §3, §19).
const NO_STORE = { "Cache-Control": "no-store" };
const json = (obj, status = 200) => NextResponse.json(obj, { status, headers: NO_STORE });

export async function handleRequestOtp(req) {
  try {
    await ensureWorkerFormSchema();
    const body = await req.json().catch(() => ({}));
    const raw = body?.phone;
    if (!raw || !String(raw).trim()) return json({ message: "Please enter your phone number." }, 400);
    const key = phoneKey(raw);
    if (!key || key.length !== 10) return json({ message: "Please enter a valid phone number." }, 400);

    // Registered-user check against the Workers registry (server-side).
    let worker;
    try {
      const rows = await query(
        `SELECT id, name, mobile, status FROM workers WHERE ${last10Sql("mobile")} = ? ORDER BY id ASC LIMIT 1`,
        [key]
      );
      worker = rows[0];
    } catch (e) {
      console.error("[worker-form] registry lookup:", e?.message || e);
      return json({ message: "Could not process the request. Please try again." }, 500);
    }
    if (!worker) return json({ message: "You are not registered." }, 403);

    // Rate limiting: hourly cap + short resend cooldown, per phone.
    const [{ recent }] = await query(
      `SELECT COUNT(*) AS recent FROM worker_form_otps WHERE phone = ? AND created_at > (NOW() - INTERVAL 1 HOUR)`,
      [key]
    );
    if (Number(recent) >= MAX_OTP_PER_HOUR) {
      return json({ message: "Too many OTP requests. Please try again later." }, 429);
    }
    const [{ last_ts }] = await query(
      `SELECT UNIX_TIMESTAMP(MAX(created_at)) AS last_ts FROM worker_form_otps WHERE phone = ?`, [key]
    );
    if (last_ts && Date.now() - Number(last_ts) * 1000 < RESEND_COOLDOWN_MS) {
      return json({ message: "Please wait a few seconds before requesting another OTP." }, 429);
    }

    // Send the OTP FIRST — only persist it (and invalidate the previous one) if
    // the SMS provider actually accepted the request, so a delivery failure never
    // shows a false "OTP sent" nor wipes a still-valid previous OTP (§2, §5).
    const otp = generateOtp();
    const send = await sendOtpSms(key, otp); // never returns/echoes the OTP to the client
    // A delivery problem is never framed as an approval/activation step: the
    // browser gets a neutral retry message, the real reason is in the server log.
    if (send.status === "failed") return json({ message: "Unable to send the OTP. Please try again." }, 502);
    // Provider-unavailable → 503, not a 500 (a service state, not an app crash).
    if (send.status === "unconfigured") return json({ message: "Unable to send the OTP right now. Please try again in a moment." }, 503);

    await query(`UPDATE worker_form_otps SET consumed_at = NOW() WHERE phone = ? AND consumed_at IS NULL`, [key]);
    const expires = new Date(Date.now() + OTP_TTL_MS);
    await query(
      `INSERT INTO worker_form_otps (phone, worker_id, otp_hash, expires_at) VALUES (?, ?, ?, ?)`,
      [key, worker.id, hashOtp(otp, key), expires]
    );

    return json({
      ok: true,
      phone: maskPhone(key),
      otpLength: OTP_LENGTH,
      resendIn: Math.round(RESEND_COOLDOWN_MS / 1000),
      expiresIn: Math.round(OTP_TTL_MS / 1000),
    });
  } catch (err) {
    console.error("[worker-form] request-otp error:", err);
    return json({ message: "Could not process the request. Please try again." }, 500);
  }
}
