import { query } from "@/lib/db";

// Lazy, idempotent schema + seed for the Media → Newspapers (press coverage)
// feature. Runs once per process (mirrors the leaderAssessment pattern) since
// the deploy flow has no manual migration step.
let ensured = false;

// The starter master list shown in the Newspaper dropdown. It is DB-backed and
// extensible: admins can add more via the newspapers API / an "Other" name, and
// those show up automatically without any frontend change.
const DEFAULT_NEWSPAPERS = [
  "Dainik Bhaskar", "Haribhoomi", "Patrika", "Navbharat", "Deshbandhu",
  "Nava Bharat", "Rashtriya Sahara", "Jansatta", "Amar Ujala", "Dainik Jagran",
  "The Times of India", "The Hindu", "Hindustan", "Indian Express",
];

export async function ensurePressNotesSchema() {
  if (ensured) return;
  try {
    // `kind` (Content Type) shipped as a 3-value ENUM which rejects the richer
    // set the form now offers (News Article, Interview, Press Conference, …).
    // Widen it to VARCHAR once so any content-type string persists. Existing
    // rows keep their value.
    const col = await query(
      `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'press_notes' AND COLUMN_NAME = 'kind'`
    );
    if (String(col[0]?.t || "").toLowerCase().startsWith("enum")) {
      await query("ALTER TABLE press_notes MODIFY COLUMN kind VARCHAR(50) NULL DEFAULT 'press_note'");
    }
    // Seed the master newspaper list (idempotent — `name` is UNIQUE).
    for (let i = 0; i < DEFAULT_NEWSPAPERS.length; i++) {
      await query("INSERT IGNORE INTO newspapers (name, sort_order) VALUES (?, ?)", [DEFAULT_NEWSPAPERS[i], i]);
    }
    ensured = true;
  } catch (e) {
    console.error("[media] ensurePressNotesSchema:", e?.message || e);
  }
}

// Find-or-create a newspaper by name and return its id — used when the form
// picks "Other" and types a custom newspaper. Returns null for a blank name.
// De-duplicates on the existing UNIQUE name so the same custom paper is reused.
export async function resolveNewspaperId(name) {
  const n = String(name || "").trim();
  if (!n) return null;
  const existing = await query("SELECT id FROM newspapers WHERE name = ? LIMIT 1", [n]);
  if (existing.length) return existing[0].id;
  const res = await query("INSERT INTO newspapers (name) VALUES (?)", [n]);
  return res.insertId;
}
