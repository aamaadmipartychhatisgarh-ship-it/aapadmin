import { readFile } from "fs/promises";
import path from "path";
import { mediaQuery } from "@/lib/db";
import { getMediaFile } from "@/lib/mediaFileStore";
import { isReferencedRegistrationPhoto } from "@/lib/regPhotoUrl";

// Public read path for registration photos. The public form has no admin session,
// so it cannot use /api/media/[file] (which 401s without one). This route serves the
// SAME stored bytes — same Media Center / user_photos / worker_photos / disk
// resolution as /api/media — but only for IMAGE files that are actually stored as a
// registration photo (contacts / workers / reg_people). It is not an open proxy: an
// upload that is not referenced as one of those photos 404s here, so press notes,
// documents and unrelated media are never exposed. It creates no new storage — it
// just makes the photos the form already references loadable without an admin login.
export const dynamic = "force-dynamic";

const IMG = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

export async function GET(_req, { params }) {
  try {
    const { file } = await params;
    const name = path.basename(file || ""); // strip any path → no traversal
    if (!name || name.includes("..")) return new Response("Not found", { status: 404 });
    const ext = name.split(".").pop()?.toLowerCase();
    const type = IMG[ext];
    if (!type) return new Response("Not found", { status: 404 }); // images only

    // Only serve a file that is genuinely a registration photo — never an arbitrary
    // upload. This keeps the route anonymous-safe while exposing exactly the images
    // the public form already surfaces by URL.
    if (!(await isReferencedRegistrationPhoto(name))) return new Response("Not found", { status: 404 });

    const headers = {
      "Content-Type": type,
      "Cache-Control": "public, max-age=31536000, immutable",
    };
    const id = name.slice(0, name.length - ext.length - 1);

    const media = await getMediaFile(id);
    if (media) {
      return new Response(new Uint8Array(media.data), { status: 200, headers: { ...headers, "Content-Type": media.mime_type || type } });
    }
    try {
      const [row] = await mediaQuery("SELECT data, mime_type FROM worker_photos WHERE id = ? LIMIT 1", [id]);
      if (row) return new Response(new Uint8Array(row.data), { status: 200, headers: { ...headers, "Content-Type": row.mime_type } });
    } catch { /* worker_photos table absent — ignore and try the next source */ }
    try {
      const [userRow] = await mediaQuery("SELECT data, mime_type FROM user_photos WHERE id = ? LIMIT 1", [id]);
      if (userRow) return new Response(new Uint8Array(userRow.data), { status: 200, headers: { ...headers, "Content-Type": userRow.mime_type } });
    } catch { /* user_photos table absent — ignore and try the next source */ }

    const buf = await readFile(path.join(process.cwd(), "public", "uploads", name));
    return new Response(new Uint8Array(buf), { status: 200, headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
