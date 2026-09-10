import { handleRegSession } from "@/lib/regLinkAuth";

// GET /api/public/registration/<token>/otp/session
// → { required } (drive/general link) or { required:true, authenticated, handler }
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req, { params }) {
  const { token } = await params;
  return handleRegSession(req, token);
}
