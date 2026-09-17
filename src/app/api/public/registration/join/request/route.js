import { handleRegOtpRequest } from "@/lib/regLinkAuth";

// POST /api/public/registration/join/request  { mobile }
// Also serves resend. Sends an OTP only when the mobile belongs to a registered
// karyakarta of the active drive — the tokenless /join login.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  return handleRegOtpRequest(null, body);
}
