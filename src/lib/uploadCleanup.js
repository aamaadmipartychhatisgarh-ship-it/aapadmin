import { unlink } from "fs/promises";
import path from "path";

// Best-effort delete of a previously-stored local upload when it's replaced or
// removed, so orphaned images don't pile up under /public/uploads. Only touches
// files we own (paths under /uploads/); ignores external URLs and missing files.
export async function deleteLocalUpload(url) {
  try {
    if (!url || typeof url !== "string") return;
    if (!url.startsWith("/uploads/")) return; // not one of ours (external URL etc.)
    const name = path.basename(url); // guard against traversal
    if (!name || name.includes("..")) return;
    await unlink(path.join(process.cwd(), "public", "uploads", name));
  } catch {
    // File already gone / not writable — nothing to clean up.
  }
}
