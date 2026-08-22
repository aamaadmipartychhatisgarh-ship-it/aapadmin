import { query } from "@/lib/db";

// Party Master — the single source of truth for political party names + logos,
// managed under Administration. Created lazily & idempotently (the deploy flow
// has no manual migration step), mirroring the Caste master.
//
// Relationship model: MLA / competitor "party" columns are existing free-text
// VARCHARs. To keep every existing value working WITHOUT a destructive
// migration, those columns keep storing the party NAME (the dropdown supplies
// the exact master name), and a party's logo is resolved live by matching that
// name against this master. So an existing free-text party keeps displaying, a
// name that matches the master also shows its logo, and updating a logo here is
// reflected everywhere that party is used.
let ensured = false;

export async function ensurePartiesTable() {
  if (ensured) return true;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS parties (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        logo_url VARCHAR(1000) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_parties_name (name)
      )
    `);
    ensured = true;
    return true;
  } catch (e) {
    console.error("[parties] ensurePartiesTable:", e?.message || e);
    return false;
  }
}

// Collapse internal whitespace and trim — the canonical stored form. Case is
// preserved for display; uniqueness is enforced case-insensitively by the
// explicit duplicate check in the API (plus the UNIQUE key as a backstop).
export function normalizePartyName(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}
