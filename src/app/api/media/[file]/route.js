import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { readFile } from "fs/promises";
import path from "path";

// Serves uploaded images from /public/uploads at runtime. Next.js only reliably
// static-serves files that existed at BUILD time; files written after deploy
// (profile photos, etc.) 404 through the CDN/static handler. This route reads the
// file straight off disk in the same process that wrote it, so a freshly-uploaded
// image is available immediately. A rewrite maps /uploads/:file -> here (see
// next.config.mjs), so every stored `/uploads/...` URL keeps working unchanged.
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

    const buf = await readFile(path.join(process.cwd(), "public", "uploads", name));
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": type,
        // UUID filenames never change content → safe to cache immutably.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
