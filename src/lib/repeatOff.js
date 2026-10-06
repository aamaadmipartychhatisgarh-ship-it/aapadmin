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
// Per-type restore markers. `*_restored_at` is the audit timestamp; `*_restored_call_id`
// is the WATERMARK the membership rule actually uses: the highest calls.id that
// existed when the restore happened. "A newer off-call" is then `calls.id > watermark`
// — monotonic and clock-independent, so a restore can never be undone by a
// timezone/clock skew between NOW() and called_at (the old timestamp-only compare).
const RESTORE_COL = { switched: "switched_off_restored_at", incoming: "incoming_off_restored_at" };
const RESTORE_WM_COL = { switched: "switched_off_restored_call_id", incoming: "incoming_off_restored_call_id" };
const RESTORE_COLUMNS = [...Object.values(RESTORE_COL), ...Object.values(RESTORE_WM_COL)];

let ensured = false;        // true only once EVERYTHING below succeeded (else retried)
let idCache = null;
let restoreColsReady = false; // whether all four restore marker columns exist

async function detectRestoreCols() {
  const cols = new Set((await query(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts'
        AND COLUMN_NAME IN (${RESTORE_COLUMNS.map(() => "?").join(",")})`,
    RESTORE_COLUMNS
  )).map((r) => r.c));
  return cols;
}

// Seed the "Incoming Off" disposition, index the count subqueries, and add the four
// restore marker columns (additive; feature-detected). Only a fully successful run is
// cached — a partial failure is retried on the next request, so a process can never
// get stuck serving the lists with restore silently disabled.
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
    let cols = await detectRestoreCols();
    for (const c of Object.values(RESTORE_COL)) {
      if (!cols.has(c)) {
        try { await query(`ALTER TABLE contacts ADD COLUMN ${c} TIMESTAMP NULL`); }
        catch (e) { if (!/duplicate column/i.test(e?.message || "")) console.error(`[repeatOff] add ${c}:`, e?.message || e); }
      }
    }
    for (const c of Object.values(RESTORE_WM_COL)) {
      if (!cols.has(c)) {
        try { await query(`ALTER TABLE contacts ADD COLUMN ${c} INT NULL`); }
        catch (e) { if (!/duplicate column/i.test(e?.message || "")) console.error(`[repeatOff] add ${c}:`, e?.message || e); }
      }
    }
    cols = await detectRestoreCols();
    restoreColsReady = RESTORE_COLUMNS.every((c) => cols.has(c));
    if (!restoreColsReady) console.error("[repeatOff] restore marker columns missing — restore disabled until they exist:", RESTORE_COLUMNS.filter((c) => !cols.has(c)).join(", "));
    ensured = restoreColsReady;
  } catch (e) {
    console.error("[repeatOff] ensure:", e?.message || e);
  }
}

// True when the restore markers are usable (schema ensured). Exposed so the restore
// endpoint can refuse clearly instead of pretending a restore worked.
export async function repeatOffRestoreAvailable() {
  await ensureRepeatOffSchema();
  return restoreColsReady;
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
  const ids = { switched: by[REPEAT_OFF_STATUSES.switched] || null, incoming: by[REPEAT_OFF_STATUSES.incoming] || null };
  // Cache only a complete answer — a status seeded later must be picked up.
  if (ids.switched && ids.incoming) idCache = ids;
  return ids;
}

// Count of a contact's calls with one status id — a correlated subquery keyed on the
// indexed calls.contact_id. statusId is a validated integer, so it is injection-safe.
function countExpr(alias, statusId) {
  return `(SELECT COUNT(*) FROM calls cx WHERE cx.contact_id = ${alias}.id AND cx.status_id = ${Number(statusId)})`;
}

// The boolean SQL expression "this contact is currently IN the 10+ list for `type`":
// at/over the threshold AND (never restored, OR an off-call of that type was logged
// AFTER the last restore). "After" is decided by the call-id watermark; the
// timestamp is only consulted for rows restored before the watermark column
// existed (watermark NULL, timestamp set).
function inListExpr(type, statusId, alias) {
  const over = `${countExpr(alias, statusId)} >= ${REPEAT_OFF_THRESHOLD}`;
  // Without the restore columns, membership is purely the count (restore disabled —
  // ensureRepeatOffSchema keeps retrying so this is transient, never silent-forever).
  if (!restoreColsReady) return `(${over})`;
  const ts = `${alias}.${RESTORE_COL[type]}`;
  const wm = `${alias}.${RESTORE_WM_COL[type]}`;
  const newer = `EXISTS (SELECT 1 FROM calls cy WHERE cy.contact_id = ${alias}.id AND cy.status_id = ${Number(statusId)}
                   AND (CASE WHEN ${wm} IS NOT NULL THEN cy.id > ${wm} ELSE cy.called_at > ${ts} END))`;
  return `(${over} AND ((${ts} IS NULL AND ${wm} IS NULL) OR ${newer}))`;
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

// Is this contact currently in the 10+ list for ONE type?
export async function isContactInRepeatOffList(contactId, type) {
  const { switched, incoming } = await statusIds();
  const t = type === "incoming" ? "incoming" : "switched";
  const id = t === "incoming" ? incoming : switched;
  if (!id) return false;
  const [row] = await query(`SELECT ${inListExpr(t, id, "c")} AS hit FROM contacts c WHERE c.id = ?`, [contactId]);
  return !!(row && Number(row.hit) === 1);
}

// Explicit restore of a contact from ONE 10+ list: a true MOVE of the same row.
// Stamps the per-type watermark (highest existing calls.id) + timestamp, reopens the
// record and drops any caller lock, so the contact leaves that list on the very next
// read and re-enters the active/assignable pool. No call history is touched; a later
// off-call of that type (id > watermark) re-triggers the automatic rule.
//
// Idempotent: only a contact CURRENTLY in the list is stamped. A second click /
// repeated request / stale page finds nothing to move and returns { moved: false }
// without touching the row (so it can never push the watermark past a newer
// off-call that legitimately re-qualified the contact in between).
export async function restoreRepeatOff(contactId, type) {
  await ensureRepeatOffSchema();
  if (!restoreColsReady) throw new Error("Restore markers are not available on this database.");
  const t = type === "incoming" ? "incoming" : "switched";
  if (!(await isContactInRepeatOffList(contactId, t))) return { moved: false };
  const { switched, incoming } = await statusIds();
  const statusId = t === "incoming" ? incoming : switched;
  const res = await query(
    `UPDATE contacts c
        SET c.${RESTORE_WM_COL[t]} = (SELECT COALESCE(MAX(x.id), 0) FROM calls x),
            c.${RESTORE_COL[t]} = NOW(),
            c.is_completed = 0,
            c.locked_by_user_id = NULL,
            c.locked_at = NULL
      WHERE c.id = ? AND ${inListExpr(t, statusId, "c")}`,
    [contactId]
  );
  return { moved: (res?.affectedRows || 0) > 0 };
}
