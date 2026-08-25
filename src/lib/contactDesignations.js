import { query } from "@/lib/db";

// PROMPT 5 — a contact can hold MANY designations. The relationship lives in
// contact_designations(contact_id, designation_id) with UNIQUE(contact_id,
// designation_id). The legacy contacts.designation_id column is kept as the
// "primary" (first) designation for backward compatibility (older reads, the
// worker-less filter fallback); the full set is the join table.

let ensured = false;
export async function ensureContactDesignationsSchema() {
  if (ensured) return;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS contact_designations (
         id INT AUTO_INCREMENT PRIMARY KEY,
         contact_id INT NOT NULL,
         designation_id INT NOT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         UNIQUE KEY uq_contact_designation (contact_id, designation_id),
         KEY idx_contact (contact_id),
         KEY idx_designation (designation_id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    // One-time backfill: every contact that has a legacy single designation_id
    // but no join rows becomes a single-designation row — so existing contacts
    // keep exactly their one designation and nothing is lost.
    await query(
      `INSERT IGNORE INTO contact_designations (contact_id, designation_id)
       SELECT c.id, c.designation_id
         FROM contacts c
        WHERE c.designation_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM contact_designations cd WHERE cd.contact_id = c.id)`
    );
    ensured = true;
  } catch (e) {
    console.error("[contacts] ensureContactDesignationsSchema:", e?.message || e);
  }
}

// Accept an array ([1,2]) or CSV ("1,2") of designation ids → clean, de-duped
// positive integers (order preserved). Returns [] when nothing valid.
export function parseDesignationIds(input) {
  const raw = Array.isArray(input) ? input : String(input ?? "").split(",");
  const out = [];
  for (const v of raw) {
    const n = parseInt(v, 10);
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

// Replace a contact's designation set with exactly `ids` (empty clears them).
// Removing one keeps the rest; adding one keeps the rest — it's a full sync of
// the provided set, and UNIQUE prevents duplicates. Returns the final ids.
export async function syncContactDesignations(contactId, ids) {
  await ensureContactDesignationsSchema();
  const wanted = parseDesignationIds(ids);
  await query(`DELETE FROM contact_designations WHERE contact_id = ?`, [contactId]);
  for (const d of wanted) {
    // eslint-disable-next-line no-await-in-loop
    await query(`INSERT IGNORE INTO contact_designations (contact_id, designation_id) VALUES (?, ?)`, [contactId, d]);
  }
  return wanted;
}

// SQL fragments the list/resolve queries reuse (correlated subqueries on c.id):
//   • DESIGNATION_IDS_SQL   → CSV of a contact's designation ids (for edit preload)
//   • DESIGNATION_NAMES_SQL → comma-joined designation names (for display)
export const DESIGNATION_IDS_SQL =
  `(SELECT GROUP_CONCAT(cd.designation_id ORDER BY cd.id) FROM contact_designations cd WHERE cd.contact_id = c.id)`;
export const DESIGNATION_NAMES_SQL =
  `(SELECT GROUP_CONCAT(dd.name ORDER BY dd.name SEPARATOR ', ')
      FROM contact_designations cd JOIN designations dd ON dd.id = cd.designation_id
     WHERE cd.contact_id = c.id)`;
