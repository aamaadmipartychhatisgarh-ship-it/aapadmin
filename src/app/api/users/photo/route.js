import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { randomUUID } from "crypto";
import { query } from "@/lib/db";
import { sniffImage, IMAGE_TYPES } from "@/lib/imageSniff";

// POST /api/users/photo (multipart/form-data: field "file")
// Returns: { url: "/uploads/<uuid>.<ext>" } — every signed-in user can call
// this for their OWN profile photo (see PUT /api/users/me/photo, which is
// what actually attaches the returned url to the caller's account).
// DB-stored (user_photos), survives redeploys, served back out through
// /api/media/[file].
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ message: "No file provided" }, { status: 400 });
    }
    // Cropped + compressed client-side toward <300KB (ProfilePhoto.jsx) — 5MB
    // is a generous margin, and keeps DB rows small.
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ message: "File too large (max 5 MB)" }, { status: 413 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffImage(buffer);
    if (!sniffed || !IMAGE_TYPES[sniffed]) {
      return NextResponse.json({ message: "Unsupported file type. Use JPG, PNG or WEBP." }, { status: 415 });
    }
    const id = randomUUID();
    await query("INSERT INTO user_photos (id, mime_type, data) VALUES (?, ?, ?)", [id, sniffed, buffer]);
    return NextResponse.json({ url: `/uploads/${id}.${IMAGE_TYPES[sniffed]}`, size: file.size, type: sniffed });
  } catch (err) {
    console.error("user photo upload error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
