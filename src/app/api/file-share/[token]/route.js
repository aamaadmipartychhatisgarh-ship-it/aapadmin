import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { findFileShare, readFileShareBytes, SHARE_TYPES } from "@/lib/fileShares";
import { userCanAccessPath } from "@/lib/pageAccess";

// GET /api/file-share/<token> — opens a shared file. NOT public:
//   • not signed in            → sent to the login page, and back here after signing in;
//   • signed in                → served only to the person who shared it, or to a user who has access to the page the file
//                                 was exported from (the same Page Access / role rules as that page);
//   • unknown / expired link   → 404.
// PDFs open inline; Excel / CSV download with their original name and format. Never cached or indexed.
export const dynamic = "force-dynamic";
const PLAIN = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(req, { params }) {
  try {
    const { token } = await params;
    const share = await findFileShare(token);
    if (!share) return new Response("This share link is invalid or has expired. Ask the sender to share the file again.", { status: 404, headers: PLAIN });
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      const back = new URL(req.url).pathname;
      return new Response(null, { status: 302, headers: { Location: `/login?next=${encodeURIComponent(back)}`, "Cache-Control": "no-store" } });
    }
    const isOwner = share.created_by != null && Number(share.created_by) === Number(session.user.id);
    const allowed = isOwner || (share.source_path ? await userCanAccessPath(session, share.source_path) : false);
    if (!allowed) return new Response("You do not have access to this file. It can only be opened by users who have access to the page it was exported from.", { status: 403, headers: PLAIN });
    const buf = await readFileShareBytes(share);
    if (!buf) return new Response("This shared file is no longer available.", { status: 404, headers: PLAIN });
    const t = SHARE_TYPES[share.file_type] || SHARE_TYPES.pdf;
    const ascii = share.filename.replace(/[^\x20-\x7e]/g, "_");
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": t.mime === "text/csv" ? "text/csv; charset=utf-8" : t.mime,
        "Content-Length": String(buf.length),
        "Content-Disposition": `${share.file_type === "pdf" ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(share.filename)}`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[file-share] GET error:", err?.message || err);
    return new Response("Could not open the shared file.", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
