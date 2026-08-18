import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { readFile } from "fs/promises";
import path from "path";
import { query } from "@/lib/db";
import { getMediaFile } from "@/lib/mediaFileStore";

// Serves every /uploads/... URL, from three possible backends:
//  1. worker_photos (DB-stored — durable across redeploys, see
//     scripts/add-worker-photos-schema.mjs) — legacy data only now (Worker
//     Management was removed, nothing writes new rows here), kept so photos
//     uploaded before the removal — including ones backfilled onto
//     contacts.photo_url — keep resolving. Checked first, by the uuid
//     portion of the filename.
//  2. user_photos (same pattern, for caller/staff profile photos — see
//     scripts/add-user-photos-schema.mjs and /api/users/photo).
//  3. Local disk under /public/uploads (press notes, debate briefs, social
//     post media, and any legacy photo uploaded before the DB-storage
//     migration) — the original fallback. Next.js only reliably static-serves
//     files that existed at BUILD time; files written after deploy 404 through
//     the CDN/static handler, so this route reads them straight off disk in
//     the same process that wrote them.
// A rewrite maps /uploads/:file -> here (see next.config.mjs), so every
// stored `/uploads/...` URL — DB-backed or disk-backed — keeps working
// through the same route.
export const dynamic = "force-dynamic";

// Every extension the Media Center can store must be serveable — images AND the
// document formats a newspaper cutting can arrive as. PDF was missing here, so a
// cutting uploaded as a PDF stored fine but 404'd when opened (the extension had
// no MIME → the guard below rejected it). That was the "upload doesn't work /
// can't open the cutting" bug for PDFs.
const TYPES = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export async function GET(_req, { params }) {
  try {
    // Uploaded photos are personal data — only serve them to signed-in users.
    const session = await getServerSession(authOptions);
    if (!session) return new Response("Unauthorized", { status: 401 });
    const { file } = await params;
    const name = path.basename(file || ""); // strip any path → no traversal
    if (!name || name.includes("..")) return new Response("Not found", { status: 404 });
    const ext = name.split(".").pop()?.toLowerCase();
    const type = TYPES[ext];
    if (!type) return new Response("Not found", { status: 404 });

    const headers = {
      "Content-Type": type,
      // UUID filenames never change content → safe to cache immutably.
      "Cache-Control": "public, max-age=31536000, immutable",
    };

    const id = name.slice(0, name.length - ext.length - 1);
    // The two DB-backed stores below are LEGACY and optional — a deployment that
    // never ran their migrations has no worker_photos / user_photos tables. A
    // missing table must NOT abort the request (it used to throw straight to the
    // 404 catch, so every disk-backed upload — e.g. a freshly uploaded contact
    // photo — silently 404'd and never displayed). Swallow per-lookup errors and
    // fall through to the disk read.
    try {
      const [row] = await query("SELECT data, mime_type FROM worker_photos WHERE id = ? LIMIT 1", [id]);
      if (row) {
        return new Response(new Uint8Array(row.data), { status: 200, headers: { ...headers, "Content-Type": row.mime_type } });
      }
    } catch { /* worker_photos table absent — ignore and try the next source */ }
    try {
      const [userRow] = await query("SELECT data, mime_type FROM user_photos WHERE id = ? LIMIT 1", [id]);
      if (userRow) {
        return new Response(new Uint8Array(userRow.data), { status: 200, headers: { ...headers, "Content-Type": userRow.mime_type } });
      }
    } catch { /* user_photos table absent — ignore and try the next source */ }

    // Durable Media Center store (newspaper cuttings, coverage PDFs, briefs, …).
    // Checked before disk so files keep resolving across redeploys / on hosts
    // whose public/uploads isn't persistent. Serves with the stored MIME type,
    // so a PDF opens as a PDF.
    const media = await getMediaFile(id);
    if (media) {
      return new Response(new Uint8Array(media.data), { status: 200, headers: { ...headers, "Content-Type": media.mime_type || type } });
    }

    const buf = await readFile(path.join(process.cwd(), "public", "uploads", name));
    return new Response(new Uint8Array(buf), { status: 200, headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
