import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isPressMedia, isSocialMedia } from "@/lib/permissions";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

// POST /api/uploads (multipart/form-data: field "file")
// Returns: { url: "/uploads/...." }
// Files are stored under /public/uploads/ which Next.js serves statically.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    // Press/social media staff upload files for their modules too.
    if (!session || !(isOversight(session) || isPressMedia(session) || isSocialMedia(session))) {
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
    const dir = path.join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    const safeName = (file.name || "upload").replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `${Date.now()}-${safeName}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(dir, filename), buffer);
    return NextResponse.json({ url: `/uploads/${filename}`, size: file.size, name: file.name });
  } catch (err) {
    console.error("upload error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
