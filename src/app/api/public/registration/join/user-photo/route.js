import { handleRegUserPhoto } from "@/lib/regLinkAuth";

// GET /api/public/registration/join/user-photo?username=...
// Returns { name, photo_url } for the active drive's worker with that username, so
// the login screen can show the user's existing photo above the password (§2).
// Read-only; does not authenticate. Unknown username → {}.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req) {
  const username = new URL(req.url).searchParams.get("username") || "";
  return handleRegUserPhoto(username);
}
