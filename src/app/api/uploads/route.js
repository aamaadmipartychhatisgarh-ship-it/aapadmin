import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isPressMedia, isSocialMedia, isCaller } from "@/lib/permissions";
import { writeFile, mkdir } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";

// Accepted image types + their canonical extension. MIME is validated against the
// actual bytes (magic numbers) below, not just the client-declared type, so an
// executable renamed to .jpg can't be stored.
const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "image/webp";
  return null;
}

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
