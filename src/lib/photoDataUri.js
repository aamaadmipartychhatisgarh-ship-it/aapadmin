import path from "path";
import { readFile } from "fs/promises";
import { query } from "@/lib/db";
import { getMediaFile } from "@/lib/mediaFileStore";

// Resolve a stored photo URL (/uploads/<uuid>.<ext>, /api/media/<uuid>.<ext>, …)
// to a base64 data: URI by reading the bytes DIRECTLY from the durable stores and
// disk — the SAME resolution order /api/media/[file] uses, but server-side with
// no HTTP round-trip and no session. This is required for PDF export: the media
// route is auth-gated, so a server-rendered @react-pdf <Image src="/uploads/…">
// can't load it; embedding the actual bytes is the only reliable way to get each
// profile's own photo into the PDF (and it can never mismatch, since we resolve
// per record). Returns null when there is no photo or it can't be read, so the
// caller renders a placeholder instead of a broken image.
const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

// react-pdf can only render JPEG and PNG. A WEBP/GIF data URI is silently dropped
// (the image just disappears), so for PDF use we detect the REAL format from the
// bytes' magic numbers and only emit JPEG/PNG; anything else → null (placeholder).
function pdfMimeFromBytes(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  return null; // webp / gif / unknown — not renderable by react-pdf
}
function toPdfDataUri(data) {
  const buf = Buffer.from(data);
  const mime = pdfMimeFromBytes(buf);
  return mime ? `data:${mime};base64,${buf.toString("base64")}` : null;
}

export async function photoToDataUri(url) {
  try {
    if (!url) return null;
    const name = path.basename(String(url).split("?")[0]); // strip query + any path
    if (!name || name.includes("..")) return null;
    const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
    if (ext && !MIME[ext]) return null; // only real images belong in a profile PDF
    const id = ext ? name.slice(0, name.length - ext.length - 1) : name;

    // 1–2) Legacy DB stores (worker/user photos) — absent tables are ignored.
    for (const table of ["worker_photos", "user_photos"]) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const [row] = await query(`SELECT data FROM ${table} WHERE id = ? LIMIT 1`, [id]);
        if (row?.data) return toPdfDataUri(row.data);
      } catch { /* table not present in this deployment */ }
    }
    // 3) Durable Media Center store (contacts / MLA / candidate photos).
    const media = await getMediaFile(id);
    if (media?.data) return toPdfDataUri(media.data);
    // 4) Disk fallback (legacy files written before the DB store).
    try {
      const buf = await readFile(path.join(process.cwd(), "public", "uploads", name));
      return toPdfDataUri(buf);
    } catch { /* not on disk */ }
    return null;
  } catch {
    return null;
  }
}

// Resolve many photo URLs at once, index-aligned to the input (so row N's photo
// always maps to row N — never a mismatch). Failures resolve to null.
export async function photosToDataUris(urls) {
  return Promise.all((urls || []).map((u) => photoToDataUri(u)));
}
