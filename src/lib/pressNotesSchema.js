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
    // Lok Sabha mapping for a newspaper (added idempotently for existing DBs):
    //   • lok_sabha_id  → the specific Lok Sabha (locations.id where type='lok_sabha')
    //   • lok_sabha_all → 1 when the newspaper applies to ALL constituencies. This
    //     is a clear, supported flag — NOT a fake Lok Sabha record — so "All" and
    //     a specific selection are unambiguous. Legacy rows: all=0, id=NULL.
    // created_at / updated_at track when a newspaper row was added / last changed.
    await ensureColumn("newspapers", "lok_sabha_id", "INT NULL");
    await ensureColumn("newspapers", "lok_sabha_all", "TINYINT(1) NOT NULL DEFAULT 0");
    await ensureColumn("newspapers", "created_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP");
    await ensureColumn("newspapers", "updated_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
    // Seed the master newspaper list (idempotent — `name` is UNIQUE).
    for (let i = 0; i < DEFAULT_NEWSPAPERS.length; i++) {
      await query("INSERT IGNORE INTO newspapers (name, sort_order) VALUES (?, ?)", [DEFAULT_NEWSPAPERS[i], i]);
    }
    ensured = true;
  } catch (e) {
    console.error("[media] ensurePressNotesSchema:", e?.message || e);
  }
}

// Add a column only if it's missing (MySQL lacks ADD COLUMN IF NOT EXISTS), so
// both fresh and already-created deployments converge without a manual step.
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
