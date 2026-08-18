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
    const col = await query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'press_conferences' AND COLUMN_NAME = 'file_url'`
    );
    if (col.length === 0) {
      await query("ALTER TABLE press_conferences ADD COLUMN file_url VARCHAR(512) NULL");
    }
    ensured = true;
  } catch (e) {
    console.error("[media] ensureConferenceSchema:", e?.message || e);
  }
}
