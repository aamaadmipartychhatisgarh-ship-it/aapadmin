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
    return;
  }
  await backfillMainWing();
}

// ONE-TIME, ledger-guarded, additive: Main used to be saved as a blank placeholder (a designation pair with no Wing, and no
// contact_wings tag), so it never showed in the Contact List or matched a Wing filter. Existing pairs of a designation that belongs
// to no other Wing now carry the Main wing's name and the contact its Main tag - the same shape every other Wing already has.
// Only blank pairs / missing tags are filled; nothing is changed or removed, and a re-run finds nothing to do.
async function backfillMainWing() {
  try {
    await query(`CREATE TABLE IF NOT EXISTS app_migrations (name VARCHAR(128) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    if ((await query("SELECT 1 FROM app_migrations WHERE name = ? LIMIT 1", ["main_wing_backfill_v1"])).length) return;
    const [main] = await query("SELECT name FROM wings WHERE is_main = 1 ORDER BY id LIMIT 1");
    if (!main) return;                                                   // Wing master not set up yet - try again next start
    if (!(await query("SHOW COLUMNS FROM contact_designations LIKE 'wing'")).length) return;
    await query("CREATE TABLE IF NOT EXISTS designation_wings (designation_id INT NOT NULL, wing VARCHAR(120) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (designation_id, wing), KEY idx_wing (wing)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    const mainOnly = `(d.wing IS NULL OR TRIM(d.wing) = '' OR d.wing = ?) AND NOT EXISTS (SELECT 1 FROM designation_wings dw WHERE dw.designation_id = d.id AND dw.wing <> ?)`;
    await query(
      `UPDATE contact_designations cd JOIN designations d ON d.id = cd.designation_id SET cd.wing = ? WHERE (cd.wing IS NULL OR TRIM(cd.wing) = '') AND ${mainOnly}`,
      [main.name, main.name, main.name]
    );
    await query("INSERT IGNORE INTO contact_wings (contact_id, wing) SELECT DISTINCT contact_id, wing FROM contact_designations WHERE wing = ?", [main.name]);
    await query("INSERT IGNORE INTO app_migrations (name) VALUES (?)", ["main_wing_backfill_v1"]);
  } catch (e) {
    console.error("[contacts] backfillMainWing:", e?.message || e);
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
