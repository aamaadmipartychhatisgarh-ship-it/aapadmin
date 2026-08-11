import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { writeFile, mkdir } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import { sniffMediaFile, MEDIA_TYPES } from "@/lib/mediaFileSniff";

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
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ message: "File too large (max 25 MB)." }, { status: 413 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffMediaFile(buffer, file.name || "");
    if (!sniffed || !MEDIA_TYPES[sniffed]) {
      return NextResponse.json(
        { message: "Unsupported file type. Use PDF, JPG, PNG, WEBP, DOC or DOCX." },
        { status: 415 }
      );
    }
    const dir = path.join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    const filename = `${randomUUID()}.${MEDIA_TYPES[sniffed]}`;
    await writeFile(path.join(dir, filename), buffer);
    return NextResponse.json({ url: `/uploads/${filename}`, type: sniffed, size: file.size });
  } catch (err) {
    console.error("media upload error:", err);
    return NextResponse.json({ message: "File upload failed. Please try again." }, { status: 500 });
  }
}
