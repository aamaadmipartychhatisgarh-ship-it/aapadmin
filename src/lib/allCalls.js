import { query } from "@/lib/db";
import { ensureUnfilteredCallLogSchema } from "@/lib/unfilteredContacts";

// Every CALL the app counts — Regular Calls (`calls`, logged against a Contact)
// plus Unfiltered Calls (`unfiltered_call_logs`, logged against an Unfiltered
// Contact from My Workspace → Unfiltered Calls) — as ONE derived table with the
// `calls` column names, so calling statistics read both without each screen
// re-implementing the merge:
//
//   const u = await callsUnion({ where: " AND DATE(c.called_at) >= ?", params: [from] });
//   query(`SELECT COUNT(*) FROM ${u.sql} c`, [...u.params]);
//
// • Each call record appears exactly once (UNION ALL of two disjoint tables);
//   unfiltered rows get a NEGATIVE id so ids never collide, and `call_type` says
//   which kind a row is ('regular' | 'unfiltered').
// • `where` (conditions on alias `c`, starting with " AND …") is applied INSIDE
//   both branches (so date bounds narrow each side before the union); its params
//   are bound once per branch (handled here).
// • `reach_key` identifies the person reached ('c<contact_id>' / 'u<unfiltered
//   id>') for COUNT(DISTINCT …) "unique reached" figures across both kinds.
// • Unfiltered rows carry the Unfiltered Contact's district / assembly and the
//   Lok Sabha / Zone above that district, so territory scoping applies to them
//   the same way. Fields only regular calls have (sentiment, follow-up, VIP,
//   designation) are NULL / 0 there.
//
// Per-contact logic (a contact's call history, queue rules, wrong-number /
// repeat-off detection) must keep using `calls` directly — this is for counts.

const COLS = [
  "contact_id", "person_name", "phone_number", "sentiment", "status_id", "called_at", "user_id",
  "district_id", "assembly_id", "zone_id", "lok_sabha_id", "designation_id", "remarks",
  "duration_seconds", "is_follow_up_required", "follow_up_date", "is_vip",
];

let colsPromise;
function callColumns() {
  if (!colsPromise) {
    colsPromise = query(
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'calls'`
    ).then((rows) => new Set(rows.map((r) => r.name))).catch((e) => { colsPromise = undefined; throw e; });
  }
  return colsPromise;
}

export async function callsUnion({ where = "", params = [] } = {}) {
  await ensureUnfilteredCallLogSchema();
  const have = await callColumns();
  const reg = (k) => (have.has(k) ? `c.${k}` : "NULL");
  // Both branches are simple (mergeable) derived tables, so `where` can name any
  // unified column (call_type, reach_key…) while conditions on real `calls`
  // columns still reach the base table and its indexes.
  const regular = `SELECT c.* FROM (
      SELECT c.id AS id, 'regular' AS call_type, NULL AS unfiltered_contact_id,
             CONCAT('c', COALESCE(${reg("contact_id")}, CONCAT('x', c.id))) AS reach_key,
             ${COLS.map((k) => `${reg(k)} AS ${k}`).join(", ")}
        FROM calls c
    ) c WHERE 1=1 ${where}`;
  const unfiltered = `SELECT c.* FROM (
      SELECT -l.id AS id, 'unfiltered' AS call_type, uc.id AS unfiltered_contact_id, CONCAT('u', uc.id) AS reach_key,
             NULL AS contact_id, uc.person_name AS person_name, uc.phone_number AS phone_number, NULL AS sentiment,
             l.status_id AS status_id, l.created_at AS called_at, l.caller_id AS user_id,
             uc.district_id AS district_id, uc.assembly_id AS assembly_id, lls.parent_id AS zone_id, ld.parent_id AS lok_sabha_id,
             NULL AS designation_id, l.remarks AS remarks, l.duration_seconds AS duration_seconds,
             0 AS is_follow_up_required, NULL AS follow_up_date, 0 AS is_vip
        FROM unfiltered_call_logs l
        JOIN unfiltered_contacts uc ON uc.id = l.unfiltered_contact_id
        LEFT JOIN locations ld ON ld.id = uc.district_id
        LEFT JOIN locations lls ON lls.id = ld.parent_id
    ) c WHERE 1=1 ${where}`;
  return { sql: `(${regular} UNION ALL ${unfiltered})`, params: [...params, ...params] };
}

// Calls attributed to each caller split by kind — used where a screen shows the
// Regular / Unfiltered breakdown next to the combined total.
export const CALL_TYPE_SPLIT = `SUM(c.call_type = 'regular') AS regular_calls, SUM(c.call_type = 'unfiltered') AS unfiltered_calls`;

// Assigned / Completed / Pending per caller (current state, not date-bounded):
// Regular = contacts assigned to the caller (is_completed); Unfiltered =
// Unfiltered Contacts assigned through Assigned Calls (completed_at). Totals are
// the sum of both kinds. Returns Map<user_id, {...}>.
export async function assignmentCountsByCaller() {
  await ensureUnfilteredCallLogSchema();
  const [reg, unf] = await Promise.all([
    query(`SELECT assigned_to_user_id AS uid, COUNT(*) AS assigned, SUM(is_completed = 1) AS completed
             FROM contacts WHERE assigned_to_user_id IS NOT NULL GROUP BY assigned_to_user_id`),
    query(`SELECT assigned_to_user_id AS uid, COUNT(*) AS assigned, SUM(completed_at IS NOT NULL) AS completed
             FROM unfiltered_contacts WHERE assigned_to_user_id IS NOT NULL GROUP BY assigned_to_user_id`),
  ]);
  const out = new Map();
  const n = (v) => Number(v) || 0;
  const get = (uid) => {
    if (!out.has(uid)) out.set(uid, { regular: { assigned: 0, completed: 0, pending: 0 }, unfiltered: { assigned: 0, completed: 0, pending: 0 } });
    return out.get(uid);
  };
  for (const r of reg) { const g = get(Number(r.uid)).regular; g.assigned = n(r.assigned); g.completed = n(r.completed); g.pending = g.assigned - g.completed; }
  for (const r of unf) { const g = get(Number(r.uid)).unfiltered; g.assigned = n(r.assigned); g.completed = n(r.completed); g.pending = g.assigned - g.completed; }
  for (const v of out.values()) {
    v.assigned = v.regular.assigned + v.unfiltered.assigned;
    v.completed = v.regular.completed + v.unfiltered.completed;
    v.pending = v.regular.pending + v.unfiltered.pending;
  }
  return out;
}
export const EMPTY_ASSIGNMENT = { assigned: 0, completed: 0, pending: 0, regular: { assigned: 0, completed: 0, pending: 0 }, unfiltered: { assigned: 0, completed: 0, pending: 0 } };
