import { unlink } from "fs/promises";
import path from "path";
import { query } from "@/lib/db";

// Best-effort delete of a previously-stored upload when it's replaced or
// removed, so orphaned images don't pile up. Only touches URLs we own (paths
// under /uploads/); ignores external URLs. Handles both storage backends a
// /uploads/<uuid>.<ext> URL might resolve to — the worker_photos table
// (DB-stored, see scripts/add-worker-photos-schema.mjs) and legacy local
// disk under /public/uploads — since the caller doesn't know which one a
// given URL was written to.
export async function deleteLocalUpload(url) {
  try {
    if (!url || typeof url !== "string") return;
    if (!url.startsWith("/uploads/")) return; // not one of ours (external URL etc.)
    const name = path.basename(url); // guard against traversal
    if (!name || name.includes("..")) return;

    const ext = name.split(".").pop();
    const id = ext ? name.slice(0, name.length - ext.length - 1) : name;
    await query("DELETE FROM worker_photos WHERE id = ?", [id]).catch(() => {});

    await unlink(path.join(process.cwd(), "public", "uploads", name));
  } catch {
    // File already gone / not writable — nothing to clean up.
  }
}
