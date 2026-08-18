import { query } from "@/lib/db";

// Durable storage for Media Center uploads (newspaper cuttings / coverage scans,
// debate briefs, social media, etc.). Next.js only reliably static-serves files
// that existed at BUILD time, and the app runs on a host whose disk is not
// guaranteed to persist across redeploys — so a file written only to
// public/uploads can 404 after a refresh/redeploy. This mirrors the proven
// worker_photos / user_photos pattern: the bytes live in the DB (durable) and
// are streamed back through /api/media/[file], keyed by the file's UUID.
//
// The table is created lazily & idempotently (the deploy flow has no manual
// migration step). LONGBLOB so large scans/PDFs fit the column; the real ceiling
// is the server's max_allowed_packet, which is why every write here is
// BEST-EFFORT — if the DB rejects an oversized blob the upload still succeeds via
// the disk copy, and nothing throws.
let ensured = false;

export async function ensureMediaFilesTable() {
  if (ensured) return true;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS media_files (
        id CHAR(36) PRIMARY KEY,
        mime_type VARCHAR(100) NOT NULL,
        ext VARCHAR(10) NOT NULL,
        size INT NULL,
        data LONGBLOB NOT NULL,
        created_by_user_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    ensured = true;
    return true;
  } catch (e) {
    console.error("[media] ensureMediaFilesTable:", e?.message || e);
    return false;
  }
}

// Persist one uploaded media file's bytes in the DB. Best-effort: returns true on
// success, false on any failure (e.g. blob larger than max_allowed_packet) so the
// caller can rely on the disk copy instead of failing the upload.
export async function saveMediaFile({ id, mimeType, ext, size, data, userId }) {
  if (!(await ensureMediaFilesTable())) return false;
  try {
    await query(
      `INSERT INTO media_files (id, mime_type, ext, size, data, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, mimeType, ext, size ?? null, data, userId ?? null]
    );
    return true;
  } catch (e) {
    // Most likely max_allowed_packet on a large file — log and let the disk copy
    // serve it. Never throw: a valid upload must not be reported as failed.
    console.error("[media] saveMediaFile (falling back to disk):", e?.code || e?.message);
    return false;
  }
}

// Fetch a stored media file by its UUID (the filename without extension).
// Returns { data, mime_type } or null. Never throws (missing table → null).
export async function getMediaFile(id) {
  try {
    const [row] = await query("SELECT data, mime_type FROM media_files WHERE id = ? LIMIT 1", [id]);
    return row || null;
  } catch {
    return null;
  }
}
