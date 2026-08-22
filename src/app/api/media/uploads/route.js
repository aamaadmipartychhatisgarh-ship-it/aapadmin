import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { writeFile, mkdir } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import { sniffMediaFile, MEDIA_TYPES } from "@/lib/mediaFileSniff";
import { saveMediaFile } from "@/lib/mediaFileStore";

// POST /api/media/uploads (multipart/form-data, field "file")
// Media document/image upload — press-note scans, coverage PDFs, briefs, etc.
// Unlike /api/uploads (images only, e.g. worker photos) this also accepts
// PDF/DOC/DOCX. Same safety model: magic-byte sniffing, random stored name,
// 25 MB cap. Returns { url } on success.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) {
      return NextResponse.json({ message: "You do not have permission to upload here." }, { status: 401 });
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ message: "No file provided." }, { status: 400 });
    }
    // Higher cap than images/docs so press-conference videos fit (§10.3). Very
    // large blobs may exceed the DB's max_allowed_packet — the durable store is
    // best-effort and the disk copy backs it up in that case.
    if (file.size > 200 * 1024 * 1024) {
      return NextResponse.json({ message: "File too large (max 200 MB)." }, { status: 413 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffMediaFile(buffer, file.name || "");
    if (!sniffed || !MEDIA_TYPES[sniffed]) {
      return NextResponse.json(
        { message: "Unsupported file type. Use PDF, JPG, PNG, WEBP, DOC, DOCX, MP4 or WEBM." },
        { status: 415 }
      );
    }
    const id = randomUUID();
    const ext = MEDIA_TYPES[sniffed];
    const filename = `${id}.${ext}`;

    // Durable store FIRST (survives redeploys / non-persistent disks), so the
    // file is openable after a refresh regardless of the host's filesystem. The
    // stored `/uploads/<id>.<ext>` URL is served back by /api/media/[file],
    // which now reads media_files before falling back to disk.
    const durable = await saveMediaFile({
      id, mimeType: sniffed, ext, size: file.size, data: buffer, userId: session.user.id,
    });

    // Also write a disk copy — backward-compatible with existing `/uploads/...`
    // URLs and a same-process fallback when the DB rejected the blob (e.g. a
    // very large file over max_allowed_packet). Best-effort: a read-only disk
    // must not fail the upload once the durable copy succeeded.
    try {
      const dir = path.join(process.cwd(), "public", "uploads");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, filename), buffer);
    } catch (diskErr) {
      if (!durable) throw diskErr; // neither store worked → a genuine failure
      console.error("[media] disk write skipped (durable copy saved):", diskErr?.code || diskErr?.message);
    }

    return NextResponse.json({ url: `/uploads/${filename}`, type: sniffed, size: file.size });
  } catch (err) {
    console.error("media upload error:", err);
    return NextResponse.json({ message: "File upload failed. Please try again." }, { status: 500 });
  }
}
