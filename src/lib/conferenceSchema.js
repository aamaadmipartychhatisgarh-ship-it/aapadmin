import { query } from "@/lib/db";

// Lazy, idempotent schema patch for press conferences: the original table (see
// scripts/add-media-schema.mjs) had no attachment column, so this adds
// `file_url` for the conference's speech / press note / briefing document. Runs
// once per process (the deploy flow has no manual migration step), same pattern
// as ensurePressNotesSchema. Safe to call on every read/write path.
let ensured = false;

export async function ensureConferenceSchema() {
  if (ensured) return;
  try {
    await ensureColumn("press_conferences", "file_url", "VARCHAR(512) NULL");
    // The speaking spokesperson, stored by ID (the relationship), so the profile
    // (name + photo) is always retrieved live from the spokespersons master.
    await ensureColumn("press_conferences", "spokesperson_id", "INT NULL");
    // Multiple spokespersons (§10.1) — CSV of spokesperson IDs. spokesperson_id
    // is kept as the primary/first for backward compatibility; names + photos are
    // resolved live from the spokespersons master.
    await ensureColumn("press_conferences", "spokesperson_ids", "VARCHAR(500) NULL");
    // Free-text Co-Spokesperson (§10.2) — a manually typed name, not a master ref.
    await ensureColumn("press_conferences", "co_spokesperson", "VARCHAR(255) NULL");
    // Persistent video reference (§10.3/§10.4) — a durable /uploads/... URL from
    // the shared uploader, uploadable after the conference is marked Done.
    await ensureColumn("press_conferences", "video_url", "VARCHAR(512) NULL");
    ensured = true;
  } catch (e) {
    console.error("[media] ensureConferenceSchema:", e?.message || e);
  }
}

// Accept an array (["1","2"]) or CSV ("1,2") of spokesperson ids and return a
// clean, de-duplicated array of positive integers (order preserved). Shared by
// the conference create/update routes and the media aggregate GET.
export function normalizeSpokespersonIds(input) {
  const raw = Array.isArray(input) ? input : String(input ?? "").split(",");
  const out = [];
  for (const v of raw) {
    const s = String(v ?? "").trim();
    if (/^\d+$/.test(s)) { const n = Number(s); if (n > 0 && !out.includes(n)) out.push(n); }
  }
  return out;
}

async function ensureColumn(table, column, def) {
  try {
    const rows = await query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    );
    if (Number(rows[0]?.n || 0) === 0) await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  } catch (e) { console.error(`[media] ensureColumn ${table}.${column}:`, e?.message || e); }
}
