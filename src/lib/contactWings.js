import { query } from "@/lib/db";

// A contact can belong to MANY Wings (SC, Youth, Mahila, …). The relationship
// lives in contact_wings(contact_id, wing) with UNIQUE(contact_id, wing). The
// wing VALUES are the canonical wing NAMES from Master Data → Designation → Wing
// (the single source of truth, served by /api/wings) — never a hardcoded list.
// Storing the name (not an id) keeps a contact's wings aligned with
// designations.wing, which also stores the name, so the same value reads
// identically everywhere (list, filter, forms).

let ensured = false;
export async function ensureContactWingsSchema() {
  if (ensured) return;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS contact_wings (
         id INT AUTO_INCREMENT PRIMARY KEY,
         contact_id INT NOT NULL,
         wing VARCHAR(120) NOT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         UNIQUE KEY uq_contact_wing (contact_id, wing),
         KEY idx_contact (contact_id),
         KEY idx_wing (wing)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    ensured = true;
  } catch (e) {
    console.error("[contacts] ensureContactWingsSchema:", e?.message || e);
  }
}

// Accept an array (["SC Wing", …]) or CSV string of wing NAMES → cleaned, trimmed,
// de-duped non-empty names (order preserved). Returns [] when nothing valid.
export function parseWings(input) {
  const raw = Array.isArray(input) ? input : String(input ?? "").split(",");
  const out = [];
  for (const v of raw) {
    const name = String(v ?? "").trim().slice(0, 120);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

// Replace a contact's wing set with exactly `wings` (empty clears them). It's a
// full sync of the provided set — removing one keeps the rest, adding one keeps
// the rest — and UNIQUE prevents duplicates. Returns the final wing names.
export async function syncContactWings(contactId, wings) {
  await ensureContactWingsSchema();
  const wanted = parseWings(wings);
  await query(`DELETE FROM contact_wings WHERE contact_id = ?`, [contactId]);
  for (const w of wanted) {
    // eslint-disable-next-line no-await-in-loop
    await query(`INSERT IGNORE INTO contact_wings (contact_id, wing) VALUES (?, ?)`, [contactId, w]);
  }
  return wanted;
}

// Correlated subquery (on c.id) the list/resolve queries reuse: a comma-joined
// list of a contact's wing names, in insertion order — used for display and to
// preload the edit form's Wings dropdown.
export const WINGS_SQL =
  `(SELECT GROUP_CONCAT(cw.wing ORDER BY cw.id SEPARATOR ', ') FROM contact_wings cw WHERE cw.contact_id = c.id)`;
