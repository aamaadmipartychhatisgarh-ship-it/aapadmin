import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { readFile } from "fs/promises";
import path from "path";
import { query } from "@/lib/db";

// Serves every /uploads/... URL, from two possible backends:
//  1. worker_photos (DB-stored — durable across redeploys, see
//     scripts/add-worker-photos-schema.mjs and /api/workers/photo) — checked
//     first, by the uuid portion of the filename.
//  2. Local disk under /public/uploads (press notes, debate briefs, social
//     post media, and any legacy worker photo uploaded before the DB-storage
//     migration) — the original fallback. Next.js only reliably static-serves
//     files that existed at BUILD time; files written after deploy 404 through
//     the CDN/static handler, so this route reads them straight off disk in
//     the same process that wrote them.
// A rewrite maps /uploads/:file -> here (see next.config.mjs), so every
// stored `/uploads/...` URL — DB-backed or disk-backed — keeps working
// through the same route.
export const dynamic = "force-dynamic";

const TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

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
    const [row] = await query("SELECT data, mime_type FROM worker_photos WHERE id = ? LIMIT 1", [id]);
    if (row) {
      return new Response(new Uint8Array(row.data), { status: 200, headers: { ...headers, "Content-Type": row.mime_type } });
    }

    const buf = await readFile(path.join(process.cwd(), "public", "uploads", name));
    return new Response(new Uint8Array(buf), { status: 200, headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
