import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { query } from "@/lib/db";
import { sniffImage, IMAGE_TYPES } from "@/lib/imageSniff";

// Public photo upload for the Worker Form. Unauthenticated (the form is public),
// but it accepts ONLY a real image (content-sniffed, not by extension) under a
// size cap, and stores it in the SAME persistent store the rest of the app uses
// (user_photos → served via /uploads/<id>). Returns the stored URL; the row that
// references it is written by the registration submit.
//
// Read access to /uploads/<id> still requires a signed-in session (see
// /api/media/[file]), so an uploaded worker photo is visible to admins in the
// Workers List, not to the anonymous public.
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// Light per-IP throttle so the public endpoint can't be used to flood the store.
const RATE = { max: 30, windowMs: 10 * 60 * 1000 };
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const cutoff = now - RATE.windowMs;
  const recent = (hits.get(ip) || []).filter((t) => t > cutoff);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => t > cutoff)) hits.delete(k);
  return recent.length > RATE.max;
}
function clientIp(req) {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return (fwd.split(",")[0] || req.headers.get("x-real-ip") || "unknown").trim().slice(0, 64);
}

export async function POST(req) {
  try {
    if (rateLimited(clientIp(req))) {
      return NextResponse.json({ message: "Too many uploads just now. Please wait a moment and try again." }, { status: 429, headers: NO_STORE });
    }
    let form;
    try { form = await req.formData(); } catch { return NextResponse.json({ message: "Unable to upload photo. Please try again." }, { status: 400, headers: NO_STORE }); }
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ message: "Please choose a photo to upload." }, { status: 400, headers: NO_STORE });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ message: "Photo size is too large. Please upload a smaller image." }, { status: 413, headers: NO_STORE });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffImage(buffer); // decides by content, not the file name
    if (!sniffed || !IMAGE_TYPES[sniffed]) {
      return NextResponse.json({ message: "Please upload a JPG, JPEG, PNG, or WEBP image." }, { status: 415, headers: NO_STORE });
    }
    const id = randomUUID();
    await query("INSERT INTO user_photos (id, mime_type, data) VALUES (?, ?, ?)", [id, sniffed, buffer]);
    return NextResponse.json({ url: `/uploads/${id}.${IMAGE_TYPES[sniffed]}` }, { headers: NO_STORE });
  } catch (err) {
    console.error("[registration] public photo upload error:", err);
    return NextResponse.json({ message: "Unable to upload photo. Please try again." }, { status: 500, headers: NO_STORE });
  }
}
