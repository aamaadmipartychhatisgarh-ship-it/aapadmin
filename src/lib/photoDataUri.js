import path from "path";
import { readFile } from "fs/promises";
import { getSharp } from "@/lib/sharpSafe";
import { query } from "@/lib/db";
import { getMediaFile } from "@/lib/mediaFileStore";

// Resolve a stored photo URL (/uploads/<uuid>.<ext>, /api/media/<uuid>.<ext>, …)
// to a PDF-EMBEDDABLE data: URI by reading the bytes DIRECTLY from the durable
// stores and disk — the SAME resolution order (and by the same UUID) that
// /api/media/[file] uses, but server-side with no HTTP round-trip and no session.
// This is why "works in the browser" does not imply "works in the PDF": the media
// route is auth-gated, so a server-rendered PDF can't fetch it — we must read the
// bytes ourselves and embed them.
//
// Every image is normalized through sharp to a PNG (react-pdf only reliably
// renders JPEG/PNG — a WEBP/GIF is silently dropped), resized to a sane box so
// the PDF stays small. Each record is resolved by its OWN id, so a photo can
// never map to the wrong profile. Returns null (→ placeholder) only when there is
// genuinely no readable image.
const MAX_DIM = 320;

// Raw passthrough when the bytes are already a react-pdf-renderable format.
function rawPassthrough(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return `data:image/jpeg;base64,${buf.toString("base64")}`;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return `data:image/png;base64,${buf.toString("base64")}`;
  return null;
}

async function bytesToPdfDataUri(data, tag = "") {
  if (!data) return null;
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const sharp = getSharp();
  // sharp missing (bad native binary) → don't crash: pass through JPEG/PNG bytes
  // as-is, drop anything else (WEBP/GIF just won't embed, same as before).
  if (!sharp) return rawPassthrough(buf);
  try {
    // sharp decodes JPEG/PNG/WEBP/GIF/… and re-encodes as PNG (always renderable
    // by react-pdf). rotate() bakes in EXIF orientation; resize keeps aspect ratio.
    const png = await sharp(buf).rotate().resize(MAX_DIM, MAX_DIM, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch (e) {
    // sharp couldn't decode — fall back to a raw passthrough (JPEG/PNG).
    const raw = rawPassthrough(buf);
    if (raw) return raw;
    console.error(`[photoDataUri] transcode failed${tag ? ` (${tag})` : ""}:`, e?.message || e);
    return null;
  }
}

export async function photoToDataUri(url) {
  try {
    if (!url) return null;
    const s = String(url).trim();
    // Already a usable data URI (e.g. client-provided) — normalize through sharp.
    if (s.startsWith("data:image/")) {
      const b64 = s.split(",")[1];
      return b64 ? bytesToPdfDataUri(Buffer.from(b64, "base64"), "data-uri") : null;
    }
    const name = path.basename(s.split("?")[0]); // strip query + any path
    if (!name || name.includes("..")) return null;
    const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
    const id = ext ? name.slice(0, name.length - ext.length - 1) : name;

    // 1–2) Legacy DB stores (worker/user photos) — absent tables are ignored.
    for (const table of ["worker_photos", "user_photos"]) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const [row] = await query(`SELECT data FROM ${table} WHERE id = ? LIMIT 1`, [id]);
        if (row?.data) return await bytesToPdfDataUri(row.data, table);
      } catch { /* table not present in this deployment */ }
    }
    // 3) Durable Media Center store (contacts / MLA / candidate photos).
    const media = await getMediaFile(id);
    if (media?.data) return await bytesToPdfDataUri(media.data, "media_files");
    // 4) Disk fallback (legacy files written before the DB store).
    try {
      const buf = await readFile(path.join(process.cwd(), "public", "uploads", name));
      return await bytesToPdfDataUri(buf, "disk");
    } catch { /* not on disk */ }
    return null;
  } catch (e) {
    console.error("[photoDataUri] resolve failed:", e?.message || e);
    return null;
  }
}

// Resolve many photo URLs at once, index-aligned to the input (so row N's photo
// always maps to row N — never a mismatch). Failures resolve to null.
export async function photosToDataUris(urls) {
  return Promise.all((urls || []).map((u) => photoToDataUri(u)));
}
