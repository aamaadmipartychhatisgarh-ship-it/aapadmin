import { handleRegOtpRequest } from "@/lib/regLinkAuth";

// POST /api/public/registration/<token>/otp/resend  { mobile }
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req, { params }) {
  const { token } = await params;
  const body = await req.json().catch(() => ({}));
  return handleRegOtpRequest(token, body);
}
