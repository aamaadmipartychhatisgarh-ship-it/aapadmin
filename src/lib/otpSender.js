import { maskPhone } from "@/lib/workerFormAuth";

// Pluggable OTP delivery. No SMS gateway is wired in this project yet, so this is
// a stub: it NEVER returns the OTP to the caller/response/client (§5, §18).
//
// - When WF_OTP_DEBUG=1 (or outside production) it logs the OTP to the SERVER
//   console only, so the flow can be tested before a provider exists.
// - In production without a provider it logs (masked) that delivery was skipped,
//   and never prints the OTP.
//
// To go live, integrate a provider here (MSG91 / Twilio / Fast2SMS) using
// credentials from environment variables and return { delivered: true }.
export async function sendOtpSms(phoneKeyVal, otp) {
  // --- provider integration point (add real SMS send here) ---
  // e.g. if (process.env.MSG91_AUTHKEY) { ...call provider...; return { delivered: true }; }

  const debug = process.env.WF_OTP_DEBUG === "1" || process.env.NODE_ENV !== "production";
  if (debug) {
    // Server-side only — this is the sole place the plaintext OTP is visible, and
    // it must never be enabled with real users in production.
    console.log(`[worker-form] OTP for +91${phoneKeyVal} = ${otp} (debug; no SMS provider configured)`);
    return { delivered: false, debug: true };
  }
  console.warn(`[worker-form] OTP generated for ${maskPhone(phoneKeyVal)} but no SMS provider is configured — not delivered.`);
  return { delivered: false, debug: false };
}
