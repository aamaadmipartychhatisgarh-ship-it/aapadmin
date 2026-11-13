import { query } from "@/lib/db";

// The CURRENT profile photo of each contact id: the Contact's own saved photo, else its linked Worker's photo —
// the same resolution the Contact List uses. Looked up strictly by contact id (never by name or designation).
// Returns Map(contactId -> photo_url | null). Never throws: a failed lookup just means "no photo" (placeholder).
let hasWorkerPhotoCached = null;
export async function contactPhotoMap(contactIds) {
  const out = new Map();
  const ids = [...new Set((contactIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return out;
  try {
    if (hasWorkerPhotoCached === null) {
      const r = await query(
        `SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
           AND ((TABLE_NAME = 'workers' AND COLUMN_NAME = 'photo_url') OR (TABLE_NAME = 'contacts' AND COLUMN_NAME = 'worker_id'))`
      );
      hasWorkerPhotoCached = Number(r[0]?.n || 0) >= 2;
    }
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      const ph = chunk.map(() => "?").join(",");
      // eslint-disable-next-line no-await-in-loop
      const rows = await query(
        hasWorkerPhotoCached
          ? `SELECT c.id, COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) AS photo_url
               FROM contacts c LEFT JOIN workers w ON w.id = c.worker_id WHERE c.id IN (${ph})`
          : `SELECT c.id, NULLIF(TRIM(c.photo_url), '') AS photo_url FROM contacts c WHERE c.id IN (${ph})`,
        chunk
      );
      for (const r of rows) out.set(Number(r.id), r.photo_url || null);
    }
  } catch (e) {
    console.error("[photos] contact photo lookup failed:", e?.message || e);
  }
  return out;
}
