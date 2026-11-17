import { readPdfShare } from "@/lib/pdfShares";

// GET /api/pdf-share/<token> — opens a shared PDF (inline, with its original file name). Anyone holding the unguessable
// link can open it until it expires (7 days); unknown or expired links answer 404. Never cached or indexed.
export const dynamic = "force-dynamic";

export async function GET(_req, { params }) {
  try {
    const { token } = await params;
    const s = await readPdfShare(token);
    if (!s) {
      return new Response("This share link is invalid or has expired. Ask the sender to share the PDF again.", {
        status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
      });
    }
    const ascii = s.filename.replace(/[^\x20-\x7e]/g, "_");
    return new Response(new Uint8Array(s.buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(s.buf.length),
        "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(s.filename)}`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[pdf-share] GET error:", err?.message || err);
    return new Response("Could not open the shared PDF.", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
