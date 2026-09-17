import { handleRegOtpVerify } from "@/lib/regLinkAuth";

// POST /api/public/registration/join/verify  { mobile, otp }
// Verifies the OTP for a karyakarta of the active drive and issues the handler
// session cookie (bound to that karyakarta + campaign).
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  return handleRegOtpVerify(null, body);
}
