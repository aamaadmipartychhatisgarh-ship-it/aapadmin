import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isCaller } from "@/lib/permissions";
import { randomUUID } from "crypto";
import { query } from "@/lib/db";
import { sniffImage, IMAGE_TYPES } from "@/lib/imageSniff";

// POST /api/workers/photo (multipart/form-data: field "file")
// Returns: { url: "/uploads/<uuid>.<ext>" } — SAME URL shape /api/uploads
// returns, so every existing consumer of workers.photo_url keeps working
// unchanged. Unlike /api/uploads (which writes to local disk — wiped on
// Hostinger's auto-deploy-on-every-push, see scripts/add-worker-photos-schema.mjs),
// this stores the image bytes in the `worker_photos` table, in the same
// persistent MariaDB instance as everything else, so a worker photo survives
// redeploys. Served back out through /api/media/[file], which checks
// worker_photos before falling back to disk.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !(isOversight(session) || isCaller(session))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ message: "No file provided" }, { status: 400 });
    }
    // Worker photos are cropped + compressed client-side toward <300KB
    // (src/components/ProfilePhoto.jsx) — 5MB is a generous margin, and keeps
    // DB rows small.
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ message: "File too large (max 5 MB)" }, { status: 413 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffImage(buffer);
    if (!sniffed || !IMAGE_TYPES[sniffed]) {
      return NextResponse.json({ message: "Unsupported file type. Use JPG, PNG or WEBP." }, { status: 415 });
    }
    const id = randomUUID();
    await query("INSERT INTO worker_photos (id, mime_type, data) VALUES (?, ?, ?)", [id, sniffed, buffer]);
    return NextResponse.json({ url: `/uploads/${id}.${IMAGE_TYPES[sniffed]}`, size: file.size, type: sniffed });
  } catch (err) {
    console.error("worker photo upload error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
