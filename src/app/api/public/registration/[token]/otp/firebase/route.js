import { handleRegFirebaseVerify } from "@/lib/regLinkAuth";

// POST /api/public/registration/<token>/otp/firebase  { idToken }
// Verifies the Firebase Phone-Auth ID token and, if the verified number is the
// link owner's, issues the handler session. No OTP is generated/sent/compared
// by this backend — Firebase handles delivery + verification.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req, { params }) {
  const { token } = await params;
  const body = await req.json().catch(() => ({}));
  return handleRegFirebaseVerify(token, body);
}
