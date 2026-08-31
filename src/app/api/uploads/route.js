import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isPressMedia, isSocialMedia, isCaller } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { writeFile, mkdir } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import { sniffImage, IMAGE_TYPES } from "@/lib/imageSniff";
import { saveMediaFile } from "@/lib/mediaFileStore";
import sharp from "sharp";

// Normalize an uploaded photo to a bounded, DB-safe blob. THE ROOT CAUSE of
// "photos disappear over time": a large original (a 6–12 MP phone photo can be
// 5–12 MB) could exceed MySQL's max_allowed_packet, so saveMediaFile's INSERT
// silently failed (it returns false, never throws) and the ONLY surviving copy
// was on public/uploads disk — which this host does NOT persist across
// redeploys. Days later the disk copy is gone and the photo 404s → it "vanished".
// By downscaling every photo to <=1600px and re-encoding (PNG kept lossless,
// everything else JPEG q82), the stored blob is a few hundred KB at most, so the
// DURABLE DB write always succeeds and the photo can never fall to disk-only.
// If sharp fails for any reason, we fall back to the original bytes so an upload
// is never lost.
async function normalizeImage(buffer, sniffed) {
  try {
    const img = sharp(buffer, { failOn: "none" }).rotate(); // honor EXIF orientation
    const meta = await img.metadata();
    const big = (meta.width || 0) > 1600 || (meta.height || 0) > 1600;
    let pipeline = img;
    if (big) pipeline = pipeline.resize(1600, 1600, { fit: "inside", withoutEnlargement: true });
    if (sniffed === "image/png") {
      const data = await pipeline.png({ compressionLevel: 9 }).toBuffer();
      return { data, mimeType: "image/png", ext: "png" };
    }
    const data = await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    return { data, mimeType: "image/jpeg", ext: "jpg" };
  } catch (e) {
    console.error("[uploads] sharp normalize failed, storing original:", e?.message);
    return { data: buffer, mimeType: sniffed, ext: IMAGE_TYPES[sniffed] };
  }
}

// POST /api/uploads (multipart/form-data: field "file")
// Returns: { url: "/uploads/...." }
//
// Profile-photo upload for Worker/Contact photos AND Leader-Assessment MLA /
// candidate photos (both go through the shared ProfilePhoto component). JPG /
// PNG / WEBP only, validated by magic bytes.
//
// DURABILITY (the reason a saved photo used to vanish after a refresh/redeploy):
// this host's public/uploads disk is NOT guaranteed to persist across redeploys,
// and Next.js only static-serves files that existed at BUILD time — so a photo
// written only to disk 404'd once the process/deploy that wrote it went away.
// We now store the bytes in the durable DB blob store FIRST (media_files, the
// same store the Media Center uses), keyed by the file's UUID. The returned
// `/uploads/<uuid>.<ext>` URL is served by /api/media/[file], which reads the DB
// stores before falling back to disk — so the photo survives refreshes and
// redeploys. The disk write is kept as a best-effort backward-compatible copy.
// Pages whose functionality includes a photo/screenshot upload through this
// shared endpoint. A user AUTHORIZED for any of them (by role baseline or a
// Page-Access grant) may upload for it — so a Social-Media-granted user can
// upload just like a Super Admin. This endpoint only stores the bytes and hands
// back a URL; that URL is authorized again when it is saved onto the actual
// record (social post, contact, MLA, …), so this can't leak access.
const UPLOAD_PAGE_KEYS = ["social_management", "media", "leader_assessment", "contacts"];
async function canUpload(session) {
  if (!session) return false;
  // Existing fast paths — unchanged, so Super Admin/oversight/press/social/caller
  // behave exactly as before.
  if (isOversight(session) || isPressMedia(session) || isSocialMedia(session) || isCaller(session)) return true;
  for (const key of UPLOAD_PAGE_KEYS) {
    // eslint-disable-next-line no-await-in-loop
    if (await pageAllowed(session, key, false)) return true;
  }
  return false;
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    // Authorized if a role or a Page-Access grant covers an upload-bearing page.
    if (!(await canUpload(session))) {
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

    // Downscale/re-encode so the stored blob is small enough to always persist
    // durably (see normalizeImage — this is the fix for photos vanishing over
    // time). The stored bytes, MIME and extension come from the NORMALIZED image.
    const norm = await normalizeImage(buffer, sniffed);

    // Store under a random UUID name (never the client filename) with the
    // normalized extension, so uploads can't collide, be guessed, or carry a
    // script name. A fresh UUID per upload also means replacing a photo yields a
    // NEW URL, so no browser/CDN cache ever serves the old image for the new one.
    const id = randomUUID();
    const ext = norm.ext;
    const filename = `${id}.${ext}`;

    // Durable store FIRST (survives redeploys / non-persistent disk). Best-effort:
    // returns false (never throws) if the DB rejects the blob — the disk copy then
    // carries the file for this process's lifetime.
    const durable = await saveMediaFile({
      id, mimeType: norm.mimeType, ext, size: norm.data.length, data: norm.data, userId: session?.user?.id,
    });

    // Also write a disk copy — backward-compatible with the existing `/uploads/...`
    // serving fallback and a same-process safety net when the durable write
    // failed. A read-only/full disk must NOT fail the upload once the durable
    // copy succeeded.
    try {
      const dir = path.join(process.cwd(), "public", "uploads");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, filename), norm.data);
    } catch (diskErr) {
      if (!durable) throw diskErr; // neither store worked → a genuine failure
      console.error("[uploads] disk write skipped (durable copy saved):", diskErr?.code || diskErr?.message);
    }

    return NextResponse.json({ url: `/uploads/${filename}`, size: norm.data.length, type: norm.mimeType });
  } catch (err) {
    console.error("upload error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
