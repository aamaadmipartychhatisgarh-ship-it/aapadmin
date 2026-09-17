import { handleRegOtpRequest } from "@/lib/regLinkAuth";

// POST /api/public/registration/join/resend  { mobile }
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  return handleRegOtpRequest(null, body);
}
