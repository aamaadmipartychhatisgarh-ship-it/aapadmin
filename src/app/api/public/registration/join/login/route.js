import { handleRegLogin } from "@/lib/regLinkAuth";

// POST /api/public/registration/join/login  { username, password }
// The common registration link's login: verifies a karyakarta's username +
// password against the active drive and issues the registration session.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  return handleRegLogin(body);
}
