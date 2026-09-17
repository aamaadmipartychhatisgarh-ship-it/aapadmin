import { handleRegSession } from "@/lib/regLinkAuth";

// GET /api/public/registration/join/session
// The tokenless /join entry. OTP is always required now: this returns
// { required:true, authenticated:false } until a registered karyakarta of the
// active drive signs in, then { required:true, authenticated:true, handler }.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req) {
  return handleRegSession(req, null);
}
