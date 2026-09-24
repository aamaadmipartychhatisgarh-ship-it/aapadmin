import { query } from "@/lib/db";

// LOK SABHA MASTER SEQUENCE.
//
// Lok Sabha constituencies live in the shared `locations` table (type =
// 'lok_sabha') and originally had NO ordering column, so every consumer fell
// back to alphabetical (ORDER BY name). The Administration Master Plan requires
// Lok Sabha to always appear in the Lok Sabha Master's stored SEQUENCE — never
// alphabetically — consistently across dropdowns, filters, hierarchy views,
// reports, tables and dashboards.
//
// This adds a nullable `sort_order` to `locations` and backfills the existing
// Lok Sabha rows in their stored master order (insertion / id order). Only Lok
// Sabha rows are sequenced; every other location type keeps NULL sort_order and
// therefore keeps ordering by name EXACTLY as before — so this is additive and
// changes nothing for districts/assemblies/zones.

let ensured = false;
export async function ensureLocationSortOrder() {
  if (ensured) return;
  try {
    const cols = await query("SHOW COLUMNS FROM locations LIKE 'sort_order'");
    if (!cols.length) {
      await query("ALTER TABLE locations ADD COLUMN sort_order INT NULL");
    }
    // Backfill Lok Sabha rows only when NONE are sequenced yet, preserving the
    // master's existing order (id / insertion order). Idempotent and safe: it
    // never runs again once a sequence exists, so an admin-set order (or a
    // freshly appended Lok Sabha) is never overwritten.
    const [{ n }] = await query(
      "SELECT COUNT(*) AS n FROM locations WHERE type = 'lok_sabha' AND sort_order IS NOT NULL"
    );
    if (Number(n) === 0) {
      const rows = await query("SELECT id FROM locations WHERE type = 'lok_sabha' ORDER BY id ASC");
      for (let i = 0; i < rows.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        await query("UPDATE locations SET sort_order = ? WHERE id = ?", [i, rows[i].id]);
      }
    }
    ensured = true;
  } catch (e) {
    console.error("[locationOrder] ensureLocationSortOrder:", e?.message || e);
  }
}

// The next sequence value to append a new Lok Sabha at the end of the master
// order. Returns 0 when none exist yet.
export async function nextLokSabhaSortOrder() {
  try {
    const [{ n }] = await query(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM locations WHERE type = 'lok_sabha'"
    );
    return Number(n) || 0;
  } catch {
    return 0;
  }
}

// ORDER BY fragment honoring the stored sequence first, then name. Rows without a
// sequence (every non-Lok-Sabha type) fall through to name ordering, so mixed
// result sets are unaffected. `alias` is the table alias (e.g. "l"); "" = none.
export function locationOrderSql(alias = "") {
  const p = alias ? `${alias}.` : "";
  return `(${p}sort_order IS NULL), ${p}sort_order ASC, ${p}name ASC`;
}
