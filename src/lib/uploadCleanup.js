import { unlink } from "fs/promises";
import path from "path";
import { query } from "@/lib/db";

// Best-effort delete of a previously-stored upload when it's replaced or
// removed, so orphaned images don't pile up. Only touches URLs we own (paths
// under /uploads/); ignores external URLs. Handles every storage backend a
// /uploads/<uuid>.<ext> URL might resolve to — worker_photos, user_photos
// (DB-stored, see scripts/add-worker-photos-schema.mjs and
// scripts/add-user-photos-schema.mjs) and legacy local disk under
// /public/uploads — since the caller doesn't know which one a given URL was
// written to.
export async function deleteLocalUpload(url) {
  try {
    if (!url || typeof url !== "string") return;
    if (!url.startsWith("/uploads/")) return; // not one of ours (external URL etc.)
    const name = path.basename(url); // guard against traversal
    if (!name || name.includes("..")) return;

    // SAFETY: never delete a file that is STILL referenced by any record. A photo
    // can be shared — e.g. the recovery step reconnects a linked worker's photo onto
    // a contact, so the same file backs both the worker and the contact. Replacing
    // ONE of them must not wipe the image the other still uses. The replace/remove
    // caller updates its own row FIRST, so a remaining reference here means another
    // record genuinely still needs the file — leave it. This makes deletion happen
    // only when the file is truly orphaned (§5).
    if (await isStillReferenced(name)) return;

    const ext = name.split(".").pop();
    const id = ext ? name.slice(0, name.length - ext.length - 1) : name;
    await query("DELETE FROM worker_photos WHERE id = ?", [id]).catch(() => {});
    await query("DELETE FROM user_photos WHERE id = ?", [id]).catch(() => {});
    // Also drop the durable Media store copy (profile photos now go there via
    // /api/uploads), so replacing a photo doesn't leave its old blob orphaned.
    // Only ever called on the REPLACED old url, never the current one.
    await query("DELETE FROM media_files WHERE id = ?", [id]).catch(() => {});

    await unlink(path.join(process.cwd(), "public", "uploads", name));
  } catch {
    // File already gone / not writable — nothing to clean up.
  }
}

// Is the upload file (by its unique filename) still referenced by ANY record whose
// photo it could be — contact, field worker, or registration? If so, deleting it
// would break a photo still in use, so the caller must skip the delete. Fail-SAFE:
// if a lookup errors, assume it IS still referenced (never delete on uncertainty).
async function isStillReferenced(name) {
  const like = `%${name}`;
  const targets = [
    ["contacts", "photo_url"],
    ["workers", "photo_url"],
    ["reg_people", "photo_url"],
  ];
  for (const [table, col] of targets) {
    try {
      const rows = await query(`SELECT 1 FROM \`${table}\` WHERE \`${col}\` LIKE ? LIMIT 1`, [like]);
      if (rows.length) return true;
    } catch (e) {
      // Missing table → not a reference source here; any other error → play safe.
      if (e?.code !== "ER_NO_SUCH_TABLE" && e?.errno !== 1146) return true;
    }
  }
  return false;
}
