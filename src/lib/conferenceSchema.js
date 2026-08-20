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
    ensured = true;
  } catch (e) {
    console.error("[media] ensureConferenceSchema:", e?.message || e);
  }
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
