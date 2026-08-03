import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isPressMedia, isSocialMedia, isCaller } from "@/lib/permissions";
import { writeFile, mkdir } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import { sniffImage, IMAGE_TYPES } from "@/lib/imageSniff";

// POST /api/uploads (multipart/form-data: field "file")
// Returns: { url: "/uploads/...." }
// Files are stored under /public/uploads/ which Next.js serves statically.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    // Press/social media staff upload for their modules; callers upload worker photos.
    if (!session || !(isOversight(session) || isPressMedia(session) || isSocialMedia(session) || isCaller(session))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ message: "No file provided" }, { status: 400 });
    }
    // 25 MB cap — adjust if needed.
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ message: "File too large (max 25 MB)" }, { status: 413 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    // Validate the REAL content type from the file's magic bytes, and require it
    // to be a supported image — prevents executables/SVGs slipping through.
    const sniffed = sniffImage(buffer);
    if (!sniffed || !IMAGE_TYPES[sniffed]) {
      return NextResponse.json({ message: "Unsupported file type. Use JPG, PNG or WEBP." }, { status: 415 });
    }
    const dir = path.join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    // Store under a random UUID name (never the client filename) with the sniffed
    // extension, so uploads can't collide, be guessed, or carry a script name.
    const filename = `${randomUUID()}.${IMAGE_TYPES[sniffed]}`;
    await writeFile(path.join(dir, filename), buffer);
    return NextResponse.json({ url: `/uploads/${filename}`, size: file.size, type: sniffed });
  } catch (err) {
    console.error("upload error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
