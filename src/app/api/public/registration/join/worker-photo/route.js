import { handleRegWorkerPhoto } from "@/lib/regLinkAuth";

// GET /api/public/registration/join/worker-photo?mobile=...
// The Common Worker Data Collection Form calls this while a collector enters the
// mobile of the worker/voter being added, to fetch the SAME photo already stored
// against that person's Contact (§ worker photo). Matched by mobile only — never by
// name — and gated behind the collector's signed-in session cookie (works for both
// /join and /r/<token>, since both share the reg session). Unknown/invalid → {}.
// Read-only; it never re-uploads or duplicates a photo.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req) {
  const mobile = new URL(req.url).searchParams.get("mobile") || "";
  return handleRegWorkerPhoto(req, mobile);
}
