import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { createPdfShare, PDF_SHARE_MAX_BYTES, PDF_SHARE_TTL_DAYS } from "@/lib/pdfShares";

// POST /api/pdf-share  (body: the PDF bytes, Content-Type: application/pdf; header X-Filename: URI-encoded file name)
// Creates a secure, expiring link to EXACTLY this PDF — the fallback of the common PDF sharing system where the device
// cannot share the file itself. Signed-in users only.
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ message: "Sign in to create a share link." }, { status: 401, headers: NO_STORE });
    const len = Number(req.headers.get("content-length") || 0);
    if (len > PDF_SHARE_MAX_BYTES) return NextResponse.json({ message: `This PDF is larger than ${PDF_SHARE_MAX_BYTES / 1024 / 1024} MB and cannot be shared as a link. Download it and attach it instead.` }, { status: 413, headers: NO_STORE });
    const buf = Buffer.from(await req.arrayBuffer());
    let filename = "document.pdf";
    try { filename = decodeURIComponent(req.headers.get("x-filename") || "") || filename; } catch { /* keep default */ }
    const out = await createPdfShare(buf, filename, session.user.id || null);
    if (out.error) return NextResponse.json({ message: out.error }, { status: out.status, headers: NO_STORE });
    // A path, not an absolute URL: behind the hosting proxy req.url can carry an internal host. The browser adds its own origin.
    return NextResponse.json({ path: `/api/pdf-share/${out.token}`, expires_at: out.expires_at, ttl_days: PDF_SHARE_TTL_DAYS }, { headers: NO_STORE });
  } catch (err) {
    console.error("[pdf-share] POST error:", err?.message || err);
    return NextResponse.json({ message: "Could not create the share link." }, { status: 500, headers: NO_STORE });
  }
}
