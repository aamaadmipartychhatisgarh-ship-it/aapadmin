import { query } from "@/lib/db";
import { ensureDesignationWingsSchema, wingsMapFor } from "@/lib/designationWings";
import { ensureWingSchema } from "@/lib/wingDesignations";
import { wingShortLabel } from "@/lib/wingLabel";

// PROMPT 5 — a contact can hold MANY designations. The relationship lives in
// contact_designations(contact_id, designation_id) with UNIQUE(contact_id,
// designation_id). The legacy contacts.designation_id column is kept as the
// "primary" (first) designation for backward compatibility (older reads, the
// worker-less filter fallback); the full set is the join table.

let ensured = false;
export async function ensureContactDesignationsSchema() {
  if (ensured) return;
  try {
    // designation_wings is read by the wing filter that joins contact_designations.
    await ensureDesignationWingsSchema();
    // The Wing master (wings.is_main) is read by the Designation–Wing pair SQL below.
    await ensureWingSchema().catch(() => {});
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
    // Each designation row may be PAIRED with the Wing it is held under (NULL = not recorded /
    // Main Organisation). Existing rows keep NULL, so nothing saved changes.
    const wcol = await query("SHOW COLUMNS FROM contact_designations LIKE 'wing'");
    if (!wcol.length) {
      try { await query("ALTER TABLE contact_designations ADD COLUMN wing VARCHAR(120) NULL"); }
      catch (e) { if (!/duplicate column/i.test(e?.message || "")) throw e; }
    }
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

// Which of these designations belong to the Main wing (no other Wing), and the Main wing's name - from the Wing master.
// Never throws: where the Wing tables are not there yet nothing is treated as Main.
export async function mainWingFor(ids) {
  const none = { name: null, ids: new Set() };
  try {
    if (!ids.length) return none;
    const [main] = await query("SELECT name FROM wings WHERE is_main = 1 ORDER BY id LIMIT 1");
    if (!main) return none;
    const rows = await query(`SELECT id, wing FROM designations WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
    const map = await wingsMapFor(rows);
    const ok = new Set();
    for (const r of rows) {
      const ws = (map.get(r.id) || []).map((w) => String(w).trim()).filter(Boolean);
      if (ws.length === 0 || ws.some((w) => w.toLowerCase() === String(main.name).toLowerCase())) ok.add(Number(r.id));
    }
    return { name: main.name, ids: ok };
  } catch { return none; }
}

// Replace a contact's designation set with exactly `ids` (empty clears them).
// Removing one keeps the rest; adding one keeps the rest — it's a full sync of
// the provided set, and UNIQUE prevents duplicates. Returns the final ids.
export async function syncContactDesignations(contactId, ids) {
  await ensureContactDesignationsSchema();
  const wanted = parseDesignationIds(ids);
  // A designation that stays keeps the Wing it is paired with.
  const kept = new Map((await query(`SELECT designation_id, wing FROM contact_designations WHERE contact_id = ?`, [contactId])).map((r) => [Number(r.designation_id), r.wing]));
  await query(`DELETE FROM contact_designations WHERE contact_id = ?`, [contactId]);
  // Main is an ordinary Wing: a designation that belongs to no other Wing is saved on the Main wing (and the contact tagged with it),
  // like any other designation is saved with its Wing - never as a blank placeholder.
  const mainFor = await mainWingFor(wanted.filter((d) => !String(kept.get(d) ?? "").trim()));
  for (const d of wanted) {
    const wing = String(kept.get(d) ?? "").trim() ? kept.get(d) : (mainFor.ids.has(d) ? mainFor.name : null);
    // eslint-disable-next-line no-await-in-loop
    await query(`INSERT IGNORE INTO contact_designations (contact_id, designation_id, wing) VALUES (?, ?, ?)`, [contactId, d, wing]);
  }
  if (mainFor.ids.size) await query(`INSERT IGNORE INTO contact_wings (contact_id, wing) VALUES (?, ?)`, [contactId, mainFor.name]).catch(() => {});
  return wanted;
}

// SQL fragments the list/resolve queries reuse (correlated subqueries on c.id):
//   • DESIGNATION_IDS_SQL   → CSV of a contact's designation ids (for edit preload)
//   • DESIGNATION_NAMES_SQL → comma-joined designation names (for display)
export const DESIGNATION_IDS_SQL =
  `(SELECT GROUP_CONCAT(cd.designation_id ORDER BY cd.id) FROM contact_designations cd WHERE cd.contact_id = c.id)`;
// "designationId:Wing" pairs ('|'-separated) for the combined Designation + Wing rows.
export const DESIGNATION_PAIRS_SQL =
  `(SELECT GROUP_CONCAT(CONCAT(cd.designation_id, ':', IFNULL(cd.wing, '')) ORDER BY cd.id SEPARATOR '|') FROM contact_designations cd WHERE cd.contact_id = c.id)`;
export { parseDesignationPairs } from "@/lib/designationRows";
// A person's multiple designations are concatenated in the Designation Master
// order (sort_order, un-ordered last), NOT alphabetically — so the displayed role
// list reads in the configured sequence everywhere it appears.
export const DESIGNATION_NAMES_SQL =
  `(SELECT GROUP_CONCAT(dd.name ORDER BY (dd.sort_order IS NULL), dd.sort_order, dd.name SEPARATOR ', ')
      FROM contact_designations cd JOIN designations dd ON dd.id = cd.designation_id
     WHERE cd.contact_id = c.id)`;

// The Wing ONE designation row (alias `cd`, its designation joined as `d`) is held under — the single
// rule the Contact List, the Wing / Designation search and the exports all share:
//   1. the Wing stored on the row itself (contact_designations.wing);
//   2. else a Wing the contact is tagged with (contact_wings) that this designation belongs to (designation_wings);
//   3. else the designation's own Wing in the Designation master;
//   4. else the Main wing (Wing master, is_main = 1).
export function effectiveWingSql(cd = "cd", d = "d") {
  return `COALESCE(NULLIF(TRIM(${cd}.wing), ''),
    (SELECT ewcw.wing FROM contact_wings ewcw JOIN designation_wings ewdw ON ewdw.wing = ewcw.wing AND ewdw.designation_id = ${cd}.designation_id
      WHERE ewcw.contact_id = ${cd}.contact_id ORDER BY ewcw.id LIMIT 1),
    NULLIF(TRIM(${d}.wing), ''),
    (SELECT ewm.name FROM wings ewm WHERE ewm.is_main = 1 ORDER BY ewm.id LIMIT 1),
    'Main Organisation')`;
}

// Every Designation–Wing pair a contact holds, one entry per contact_designations row (so a contact is ONE list
// row however many it holds), in Designation Master order:
//   "designationId<US>Designation<US>Wing<US>isMain<RS>…"
// isMain = the pair's Wing is the Wing master's main wing (is_main = 1). Parsed by parseDesignationWingList.
// Control-character delimiters (never typed into a name), as SQL string literals — SEPARATOR takes a literal only.
const PAIR_US = "'\u001f'";
const PAIR_RS = "'\u001e'";
export const DESIGNATION_WING_PAIRS_SQL =
  `(SELECT GROUP_CONCAT(CONCAT(dp.id, ${PAIR_US}, dp.name, ${PAIR_US}, ${effectiveWingSql("cdp", "dp")}, ${PAIR_US},
              IF(${effectiveWingSql("cdp", "dp")} IN (SELECT pm.name FROM wings pm WHERE pm.is_main = 1) OR LOWER(${effectiveWingSql("cdp", "dp")}) IN ('main', 'main organisation', 'main organisations', 'main organization', 'main organizations'), 1, 0))
            ORDER BY (dp.sort_order IS NULL), dp.sort_order, dp.name SEPARATOR ${PAIR_RS})
      FROM contact_designations cdp JOIN designations dp ON dp.id = cdp.designation_id
     WHERE cdp.contact_id = c.id)`;

// -> [{ designation_id, designation, wing, wing_label, is_main }] — wing is the STORED Wing name, wing_label its
// display form ("Main", "Mahila", "Trade" — wingShortLabel). One entry per distinct (designation id, Wing).
export function parseDesignationWingList(raw) {
  if (raw == null || raw === "") return [];
  const out = [];
  const seen = new Set();
  for (const part of String(raw).split(String.fromCharCode(30))) {
    const [id, designation, wing, main] = part.split(String.fromCharCode(31));
    const d = String(designation || "").trim();
    if (!d) continue;
    const w = String(wing || "").trim();
    const isMain = main === "1" || !w;
    const key = `${id}\u0000${isMain ? "\u0001main" : w.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ designation_id: Number(id) || null, designation: d, wing: w, wing_label: wingShortLabel(w, isMain), is_main: isMain });
  }
  return out;
}

// Export cell: Main first, then the Wings — "Main – Vidhansabha Prabhari; Mahila – Lok Sabha Adhyaksh".
export function designationWingText(list, sep = "; ") {
  const l = list || [];
  return [...l.filter((p) => p.is_main), ...l.filter((p) => !p.is_main)]
    .map((p) => `${p.wing_label || wingShortLabel(p.wing, p.is_main)} – ${p.designation}`).join(sep);
}

// A bare `designation_id` (the Caller workspace's single dropdown) must behave
// like the Supervisor/Admin multi-select: it updates the join table, which the
// Contact List reads FIRST. Returns the new full id set when the primary really
// changed (replace-with-one, as the single dropdown shows one), or null when
// nothing changed so other designations a Supervisor added are left untouched.
export async function designationIdsFromSingle(contactId, data) {
  if (!("designation_id" in data) || "designation_ids" in data) return null;
  const next = parseDesignationIds([data.designation_id]);
  const [cur] = await query("SELECT designation_id FROM contacts WHERE id = ?", [contactId]);
  const curId = cur?.designation_id ?? null;
  if (String(curId ?? "") === String(next[0] ?? "")) return null;
  return next;
}

// How a GENERAL contact edit (admin / supervisor / caller) may change a contact's designations.
// Forms are snapshots taken when opened, so a form that was NOT used to change the designation
// (another field was edited) must never write its stale copy over a newer designation, nor clear
// it because it never loaded one; and a designation is only removed when it was deliberately
// emptied by someone allowed to.
//
//   data.designation_ids / designation_id      — what the form sends (set from the multi-select,
//                                                 or the caller workspace's single dropdown)
//   data.designation_ids_prev / designation_id_prev — what the form was OPENED with
//
// Returns:
//   { ids: null }              — nothing to do (field not sent)
//   { skip: true }             — unchanged / stale / not permitted → neither the set nor the
//                                legacy primary column is touched (+ conflict: true when someone
//                                else changed it after the form opened)
//   { ids: [...] }             — the new full set (the primary is its first id)
//   { error }                  — an id that is not in the Designation master
export async function designationsForGeneralEdit(contactId, data, canClear) {
  const hasSet = "designation_ids" in data;
  const hasOne = !hasSet && "designation_id" in data;
  if (!hasSet && !hasOne) return { ids: null };
  await ensureContactDesignationsSchema();
  const rows = await query("SELECT designation_id FROM contact_designations WHERE contact_id = ? ORDER BY id", [contactId]);
  const [c] = await query("SELECT designation_id FROM contacts WHERE id = ?", [contactId]);
  // Current designations as the app shows them: the set, else the legacy single value.
  const curIds = rows.length ? rows.map((r) => r.designation_id) : (c?.designation_id ? [c.designation_id] : []);
  // The single dropdown only ever shows (and sets) the primary.
  const cur = hasSet ? curIds : curIds.slice(0, 1);
  const next = hasSet ? parseDesignationIds(data.designation_ids) : parseDesignationIds([data.designation_id]);
  const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  // The single dropdown changes only the PRIMARY: the contact's other designations (and their Wings) stay.
  const result = (ids) => (hasSet ? ids : (ids.length ? [...new Set([...ids, ...curIds.slice(1)])] : curIds.slice(1)));
  if (same(next, cur)) return { skip: true };                       // already exactly this
  const prevKey = hasSet ? "designation_ids_prev" : "designation_id_prev";
  if (prevKey in data) {
    const prev = parseDesignationIds(hasSet ? data[prevKey] : [data[prevKey]]);
    if (same(next, prev)) return { skip: true };                    // the user did not change it: stale copy
    // The form's baseline may be the legacy `contacts.designation_id` (what the Caller card carries) while the
    // join table is the authority; either one matching what the form was opened with is NOT a foreign change.
    const legacy = c?.designation_id ? [c.designation_id] : [];
    const baselineOk = same(prev, cur) || (!hasSet && same(prev, legacy));
    if (!baselineOk) return { skip: true, conflict: true };         // changed by someone else since the form opened
    if (!next.length) return canClear ? { ids: result([]) } : { skip: true }; // deliberate clear — managers only
  } else if (!next.length) {
    return { skip: true };                                          // a blank with no baseline never clears
  }
  if (next.length) {
    const found = await query(`SELECT id, name, enabled FROM designations WHERE id IN (${next.map(() => "?").join(",")})`, next);
    if (found.length !== next.length) return { error: "That designation does not exist." };
    // A switched-off (Master Data) designation can't be newly given; one the contact already holds stays as is.
    const off = found.find((d) => d.enabled != null && Number(d.enabled) === 0 && !curIds.includes(d.id));
    if (off) return { error: `"${off.name}" is switched off in Master Data and cannot be assigned.` };
  }
  return { ids: result(next) };
}
