import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { createFileShare, FILE_SHARE_MAX_BYTES, FILE_SHARE_TTL_HOURS, SHARE_TYPES } from "@/lib/fileShares";

// POST /api/file-share  (body: the exact file bytes; headers X-Filename: URI-encoded file name, X-Source-Path: the page it was
// exported from). Creates a secure, expiring, SIGN-IN-ONLY link to exactly this PDF / Excel / CSV file — the fallback of the
// common sharing system where the device cannot share the file itself. Signed-in users only.
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ message: "Sign in to create a share link." }, { status: 401, headers: NO_STORE });
    const len = Number(req.headers.get("content-length") || 0);
    if (len > FILE_SHARE_MAX_BYTES) return NextResponse.json({ message: `This file is larger than ${FILE_SHARE_MAX_BYTES / 1024 / 1024} MB and cannot be shared as a link. Download it and attach it instead.` }, { status: 413, headers: NO_STORE });
    const buf = Buffer.from(await req.arrayBuffer());
    const dec = (h, d) => { try { return decodeURIComponent(req.headers.get(h) || "") || d; } catch { return d; } };
    const out = await createFileShare(buf, dec("x-filename", "document"), session.user.id || null, dec("x-source-path", ""));
    if (out.error) return NextResponse.json({ message: out.error }, { status: out.status, headers: NO_STORE });
    // A path, not an absolute URL: behind the hosting proxy req.url can carry an internal host. The browser adds its own origin.
    return NextResponse.json({ path: `/api/file-share/${out.token}`, expires_at: out.expires_at, ttl_hours: FILE_SHARE_TTL_HOURS, type: out.type, label: SHARE_TYPES[out.type].label }, { headers: NO_STORE });
  } catch (err) {
    console.error("[file-share] POST error:", err?.message || err);
    return NextResponse.json({ message: "Could not create the share link." }, { status: 500, headers: NO_STORE });
  }
}
