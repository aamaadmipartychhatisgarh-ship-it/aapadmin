import { query } from "@/lib/db";
import { scopeFilterSync } from "@/lib/permissions";
import { notWrongNumberClause, notNotInterestedClause, notPendingClause, ensureContactActiveStatusColumns } from "@/lib/contactExtras";
import { repeatOffExclusion } from "@/lib/repeatOff";
import { normalizeActiveStatus, ACTIVE_STATUS_VALUES } from "@/lib/activeStatus";
import { buildContactPersonFilter } from "@/lib/contactFilter";
import { DESIGNATION_NAMES_SQL, ensureContactDesignationsSchema } from "@/lib/contactDesignations";
import { CONTACT_DEFAULT_ORDER_BY } from "@/lib/contactSort";

// ACTIVE WORKERS — the single data source for the Active Workers page (caller
// groups + each caller's expanded worker list) and its PDF export. One WHERE
// clause is built here from the page's filters and the user's role scope, so the
// screen and the exported file always contain exactly the same people.
//
// Active worker = a contact assigned to a caller, live (not wrong number / not
// pending approval / not "not interested" / not repeat-off) and with one of the
// four real Worker Statuses (Not Set workers are left out of the page entirely).

const posInt = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };

export function parseActiveWorkerFilters(searchParams) {
  return {
    search: (searchParams.get("search") || "").trim(),
    district_id: posInt(searchParams.get("district_id")),
    assembly_id: posInt(searchParams.get("assembly_id")),
    block_id: posInt(searchParams.get("block_id")),
    designation_id: posInt(searchParams.get("designation_id")),
    // The caller's own status (users.active_status) — exact canonical code.
    status: normalizeActiveStatus(searchParams.get("status")),
    // Worker Status card (contacts.active_status) — exact canonical code.
    worker_status: normalizeActiveStatus(searchParams.get("worker_status")),
  };
}

// The FROM + WHERE every Active Workers query shares. `withWorkerStatus` adds
// the Worker Status card filter (left off for the card totals, which always show
// the full four-status breakdown of the current scope).
export async function activeWorkerWhere(session, f, { withWorkerStatus = true } = {}) {
  await ensureContactDesignationsSchema();
  const workerStatusReady = await ensureContactActiveStatusColumns();
  let where = " WHERE c.assigned_to_user_id IS NOT NULL";
  const params = [];
  where += await notWrongNumberClause("c");
  where += await notPendingClause("c");
  where += await notNotInterestedClause("c");
  where += await repeatOffExclusion("c");
  if (workerStatusReady) {
    where += ` AND c.active_status IN (${ACTIVE_STATUS_VALUES.map(() => "?").join(",")})`;
    params.push(...ACTIVE_STATUS_VALUES);
  } else where += " AND 1 = 0";
  // Location filters use the contact's OWN saved location — the one the list shows.
  if (f.district_id) { where += " AND c.district_id = ?"; params.push(f.district_id); }
  if (f.assembly_id) { where += " AND c.assembly_id = ?"; params.push(f.assembly_id); }
  if (f.block_id) { where += " AND c.ward_id = ?"; params.push(f.block_id); }
  // Designation: the same person-aware rule as the Contacts list (the contact's own
  // designation set, else the linked worker's position), matching what is displayed.
  if (f.designation_id) {
    const person = buildContactPersonFilter({ designation_ids: [f.designation_id] });
    where += person.where; params.push(...person.params);
  }
  if (f.search) {
    where += " AND (c.person_name LIKE ? OR c.phone_number LIKE ? OR u.username LIKE ?)";
    params.push(`%${f.search}%`, `%${f.search}%`, `%${f.search}%`);
  }
  if (f.status) { where += " AND u.active_status = ?"; params.push(f.status); }
  if (withWorkerStatus && f.worker_status) { where += " AND c.active_status = ?"; params.push(f.worker_status); }
  // Same non-bypassable geographic/role scope as the Contacts list.
  const scope = scopeFilterSync(session.user, "c");
  where += " " + scope.where;
  params.push(...scope.params);
  const from = `FROM contacts c
     JOIN users u ON u.id = c.assigned_to_user_id
     LEFT JOIN workers w ON w.id = c.worker_id`;
  return { from, where, params, workerStatusReady };
}

// Caller groups (one row per caller) + the Worker Status card totals.
export async function fetchActiveWorkerGroups(session, f) {
  const base = await activeWorkerWhere(session, f, { withWorkerStatus: false });
  const totalsRows = await query(`SELECT c.active_status AS s, COUNT(*) AS n ${base.from} ${base.where} GROUP BY c.active_status`, base.params);
  const status_totals = Object.fromEntries(ACTIVE_STATUS_VALUES.map((v) => [v, 0]));
  for (const r of totalsRows) if (r.s in status_totals) status_totals[r.s] = Number(r.n) || 0;

  const { from, where, params, workerStatusReady } = await activeWorkerWhere(session, f);
  const workerStatusSums = workerStatusReady
    ? ACTIVE_STATUS_VALUES.map((v) => `COALESCE(SUM(c.active_status = '${v}'), 0) AS ws_${v.toLowerCase()},`).join("\n            ")
      + "\n            COALESCE(SUM(c.active_status IS NULL OR c.active_status = ''), 0) AS ws_unset,"
    : "0 AS ws_unset,";
  const rows = await query(
    `SELECT c.assigned_to_user_id AS user_id, u.username, u.active_status,
            ${workerStatusSums}
            COUNT(*) AS active_count,
            COALESCE(SUM(c.is_completed = 1), 0) AS done_count,
            COALESCE(SUM(c.is_completed = 0), 0) AS pending_count
       ${from}
      ${where}
      GROUP BY c.assigned_to_user_id, u.username, u.active_status
      ORDER BY active_count DESC, u.username ASC`,
    params
  );
  const groups = rows.map((r) => ({
    user_id: r.user_id,
    username: r.username,
    active_status: r.active_status || null,
    worker_status_counts: Object.fromEntries([
      ...ACTIVE_STATUS_VALUES.map((v) => [v, Number(r[`ws_${v.toLowerCase()}`]) || 0]),
      ["UNSET", Number(r.ws_unset) || 0],
    ]),
    active_count: Number(r.active_count) || 0,
    done_count: Number(r.done_count) || 0,
    pending_count: Number(r.pending_count) || 0,
  }));
  const total = groups.reduce((a, g) => a + g.active_count, 0);
  return { groups, total, callers: groups.length, status_totals, worker_status: f.worker_status };
}

// Every matching worker (optionally one caller's), in the same order the page
// lists them: no page cap, so an expanded caller and the export are complete.
export async function fetchActiveWorkerRows(session, f, { userId = null, limit = null } = {}) {
  const { from, where, params } = await activeWorkerWhere(session, f);
  let w = where; const p = [...params];
  if (userId) { w += " AND c.assigned_to_user_id = ?"; p.push(userId); }
  return query(
    `SELECT c.id, c.person_name, c.phone_number, c.active_status, c.is_completed, c.assigned_to_user_id,
            u.username AS caller_name, u.active_status AS caller_status,
            COALESCE(${DESIGNATION_NAMES_SQL}, NULLIF(TRIM(w.position), ''), dsg.name) AS designation_name,
            ld.name AS district_name, la.name AS assembly_name, lw.name AS block_name,
            COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) AS photo_url
       ${from}
       LEFT JOIN locations ld ON ld.id = c.district_id
       LEFT JOIN locations la ON la.id = c.assembly_id
       LEFT JOIN locations lw ON lw.id = c.ward_id
       LEFT JOIN designations dsg ON dsg.id = c.designation_id
      ${w}
      ORDER BY ${CONTACT_DEFAULT_ORDER_BY}
      ${limit ? `LIMIT ${Number(limit)}` : ""}`,
    p
  );
}
