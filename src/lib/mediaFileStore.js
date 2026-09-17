import { query, mediaQuery } from "@/lib/db";

// In-process LRU cache of served blobs (id → {data, mime_type}). Photo bytes
// never change for a given UUID, so caching them is always correct. This absorbs
// the repeat/duplicate/pagination loads a Contact List generates, so most image
// requests never touch the DB at all — and the ones that do use the dedicated
// media pool. Bounded by total bytes so it can never blow the process's memory.
const CACHE_MAX_BYTES = Math.max(8, Number(process.env.MEDIA_CACHE_MB) || 64) * 1024 * 1024;
const cache = new Map(); // insertion-ordered → front is oldest (LRU)
let cacheBytes = 0;

function cacheGet(id) {
  const v = cache.get(id);
  if (v) { cache.delete(id); cache.set(id, v); } // touch → most-recently-used
  return v || null;
}
function cacheSet(id, data, mime) {
  const bytes = data?.length || 0;
  if (!bytes || bytes > CACHE_MAX_BYTES) return; // don't cache oversized blobs
  const prev = cache.get(id);
  if (prev) cacheBytes -= prev.bytes;
  cache.set(id, { data, mime_type: mime, bytes });
  cacheBytes += bytes;
  while (cacheBytes > CACHE_MAX_BYTES && cache.size) {
    const oldest = cache.keys().next().value;
    cacheBytes -= cache.get(oldest).bytes;
    cache.delete(oldest);
  }
}

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
// Serves from the in-process cache when possible; a miss reads through the
// dedicated MEDIA pool so an image burst never competes with API queries.
export async function getMediaFile(id) {
  const cached = cacheGet(id);
  if (cached) return { data: cached.data, mime_type: cached.mime_type };
  try {
    const [row] = await mediaQuery("SELECT data, mime_type FROM media_files WHERE id = ? LIMIT 1", [id]);
    if (row && row.data) cacheSet(id, row.data, row.mime_type);
    return row || null;
  } catch {
    return null;
  }
}
