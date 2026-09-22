import { query } from "@/lib/db";

// Automatic classification of contacts dispositioned "Switched Off" or "Incoming
// Off" 10 OR MORE times — counted from the ACTUAL call records (calls joined to
// call_statuses), never a manual counter. Because it is derived, editing/deleting a
// call recomputes it instantly; nothing to keep in sync. The two statuses are
// INDEPENDENT (§3): a contact can be in one, both or neither. Nothing is ever
// deleted and no duplicate contact rows exist — membership is a function of the
// call history (§10).
//
//   count(status) >= 10  →  the contact drops OUT of the main Contacts list AND
//                           out of every assignable/active list, and INTO the
//                           matching "10+ Times …" page (§4, §7).
//
// RESTORE (§8, §9): a per-type restore timestamp on the contact returns it to Main
// WITHOUT erasing any call history — it is simply treated as NOT in the list until a
// NEW off-call of that type is logged AFTER the restore (the count is cumulative, so
// any later off-call re-crosses the threshold and the automatic rule fires again).

export const REPEAT_OFF_THRESHOLD = 10; // 10 or more → qualifies (>= 10, not > 10)
export const REPEAT_OFF_STATUSES = { switched: "Switched Off", incoming: "Incoming Off" };
const RESTORE_COL = { switched: "switched_off_restored_at", incoming: "incoming_off_restored_at" };

let ensured = false;
let idCache = null;
let restoreColsReady = false; // whether the per-type restore timestamp columns exist

// Seed the "Incoming Off" disposition, index the count subqueries, and add the two
// per-type restore timestamp columns (additive; feature-detected).
export async function ensureRepeatOffSchema() {
  if (ensured) return;
  try {
    await query(`INSERT IGNORE INTO call_statuses (name) VALUES ('Incoming Off')`);
    try {
      const idx = await query(
        `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'calls' AND INDEX_NAME = 'idx_calls_contact_status'`
      );
      if (Number(idx[0]?.n || 0) === 0) {
        await query(`ALTER TABLE calls ADD INDEX idx_calls_contact_status (contact_id, status_id)`);
      }
    } catch (e) { console.error("[repeatOff] index:", e?.message || e); }
    try {
      let cols = new Set((await query(
        `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts'
            AND COLUMN_NAME IN ('switched_off_restored_at','incoming_off_restored_at')`
      )).map((r) => r.c));
      if (!cols.has("switched_off_restored_at")) await query("ALTER TABLE contacts ADD COLUMN switched_off_restored_at TIMESTAMP NULL").catch(() => {});
      if (!cols.has("incoming_off_restored_at")) await query("ALTER TABLE contacts ADD COLUMN incoming_off_restored_at TIMESTAMP NULL").catch(() => {});
      cols = new Set((await query(
        `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts'
            AND COLUMN_NAME IN ('switched_off_restored_at','incoming_off_restored_at')`
      )).map((r) => r.c));
      restoreColsReady = cols.has("switched_off_restored_at") && cols.has("incoming_off_restored_at");
    } catch (e) { console.error("[repeatOff] restore cols:", e?.message || e); }
    ensured = true;
  } catch (e) {
    console.error("[repeatOff] ensure:", e?.message || e);
  }
}

async function statusIds() {
  if (idCache) return idCache;
  await ensureRepeatOffSchema();
  const rows = await query(
    `SELECT id, name FROM call_statuses WHERE name IN (?, ?)`,
    [REPEAT_OFF_STATUSES.switched, REPEAT_OFF_STATUSES.incoming]
  );
  const by = {};
  for (const r of rows) by[r.name] = Number(r.id);
  idCache = { switched: by[REPEAT_OFF_STATUSES.switched] || null, incoming: by[REPEAT_OFF_STATUSES.incoming] || null };
  return idCache;
}

// Count of a contact's calls with one status id — a correlated subquery keyed on the
// indexed calls.contact_id. statusId is a validated integer, so it is injection-safe.
function countExpr(alias, statusId) {
  return `(SELECT COUNT(*) FROM calls cx WHERE cx.contact_id = ${alias}.id AND cx.status_id = ${Number(statusId)})`;
}

// The boolean SQL expression "this contact is currently IN the 10+ list for `type`":
// at/over the threshold AND not restored (or re-qualified by a newer off-call).
function inListExpr(type, statusId, alias) {
  const over = `${countExpr(alias, statusId)} >= ${REPEAT_OFF_THRESHOLD}`;
  // Without the restore columns, membership is purely the count (restore disabled).
  if (!restoreColsReady) return `(${over})`;
  const rcol = `${alias}.${RESTORE_COL[type]}`;
  const newer = `EXISTS (SELECT 1 FROM calls cy WHERE cy.contact_id = ${alias}.id AND cy.status_id = ${Number(statusId)} AND cy.called_at > ${rcol})`;
  return `(${over} AND (${rcol} IS NULL OR ${newer}))`;
}

// AND clause for the MAIN contacts list/count/assignment queries: keep only contacts
// NOT currently in either 10+ list.
export async function repeatOffExclusion(alias = "c") {
  const { switched, incoming } = await statusIds();
  const parts = [];
  if (switched) parts.push(`NOT ${inListExpr("switched", switched, alias)}`);
  if (incoming) parts.push(`NOT ${inListExpr("incoming", incoming, alias)}`);
  return parts.length ? " AND " + parts.join(" AND ") : "";
}

// For a "10+ Times …" page: the WHERE fragment selecting contacts currently in the
// list for ONE status, plus the count expression to display.
export async function repeatOffSelect(type, alias = "c") {
  const { switched, incoming } = await statusIds();
  const id = type === "incoming" ? incoming : switched;
  if (!id) return { where: " AND 1=0", countExpr: "0" };
  return { where: ` AND ${inListExpr(type === "incoming" ? "incoming" : "switched", id, alias)}`, countExpr: countExpr(alias, id) };
}

// Is this contact currently in EITHER 10+ list? Used by assignment endpoints to
// REJECT assigning it server-side (never rely on frontend hiding).
export async function isContactRepeatOff(contactId) {
  const { switched, incoming } = await statusIds();
  const parts = [];
  if (switched) parts.push(inListExpr("switched", switched, "c"));
  if (incoming) parts.push(inListExpr("incoming", incoming, "c"));
  if (!parts.length) return false;
  try {
    const [row] = await query(`SELECT (${parts.join(" OR ")}) AS hit FROM contacts c WHERE c.id = ?`, [contactId]);
    return !!(row && Number(row.hit) === 1);
  } catch { return false; }
}

// Explicit restore of a contact from ONE 10+ list back to Main: stamp the per-type
// restore time (so it leaves the list and re-enters active/assignable) and reopen
// the record. No call history is touched, and a later off-call re-triggers the rule.
export async function restoreRepeatOff(contactId, type) {
  await ensureRepeatOffSchema();
  const col = RESTORE_COL[type === "incoming" ? "incoming" : "switched"];
  await query(`UPDATE contacts SET ${col} = NOW(), is_completed = 0 WHERE id = ?`, [contactId]);
}
