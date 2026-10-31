import { query } from "@/lib/db";
import { ensureRegistrationSchema, resolveRegPeriod } from "@/lib/registrationSchema";
import { UNCONTACTED_FIRST_SQL } from "@/lib/registrationContactAction";
import { ensureConvertSchema, isConvertEligible } from "@/lib/registrationConvert";
import { phoneKey, last10Sql } from "@/lib/phone";
import { notPendingClause } from "@/lib/contactExtras";

// Server-side aggregation for the Voter & Worker Registration dashboard. Every
// number is computed in SQL (COUNT / GROUP BY) so the client never pulls raw rows
// to add them up. Only status='active' people count — the single "successful
// registration" definition, so duplicates/rejects never inflate a ranking.
//
// A registration's ward is the ward typed on the form; when the form left it
// blank it falls back to the collecting worker's ward, so ward-wise totals stay
// complete rather than dropping rows into an "unknown" bucket.
const WARD_EXPR = "NULLIF(TRIM(COALESCE(NULLIF(TRIM(p.ward_number),''), w.ward_number, '')),'')";

// A registration's BLOCK is its Area / Booth (§9B) — a different dimension from the
// numeric ward. Same person-aware fallback as the ward: use the value typed on the
// form, else the collecting worker's area/booth, so block totals stay complete.
const BLOCK_EXPR = "NULLIF(TRIM(COALESCE(NULLIF(TRIM(p.area_booth),''), w.area_booth, '')),'')";

// The worker join is a LEFT join throughout: a registration made through the
// GENERAL /join link belongs to no karyakarta (worker_id IS NULL). Those rows
// must still count in the drive's totals and in the ward ranking — an inner join
// would silently drop them and under-report the whole campaign. They simply do
// not appear in the worker ranking, which is correct: nobody collected them.
const PEOPLE_FROM = "FROM reg_people p LEFT JOIN reg_workers w ON w.id = p.worker_id";

// WHERE fragment shared by every people-side query.
function peopleFilters({ campaignId, from, to, ward, workerId, personType, status, search, source, scope }) {
  const cond = ["p.status = ?"];
  const params = [status || "active"];
  // Zone-wise access control: a caller is restricted to their territory's
  // assemblies (scope.cond); admins/supervisors pass an empty cond. Applied here so
  // EVERY people-side query (summary, list, ward/block/assembly rankings) is scoped
  // at the database — it can't be bypassed from the client.
  if (scope && scope.cond) { cond.push(scope.cond); params.push(...(scope.params || [])); }
  if (campaignId) { cond.push("p.campaign_id = ?"); params.push(campaignId); }
  if (from) { cond.push("p.registered_at >= ?"); params.push(`${from} 00:00:00`); }
  if (to) { cond.push("p.registered_at < DATE_ADD(?, INTERVAL 1 DAY)"); params.push(`${to} 00:00:00`); }
  if (ward) { cond.push(`${WARD_EXPR} = ?`); params.push(ward); }
  if (workerId) { cond.push("p.worker_id = ?"); params.push(workerId); }
  if (personType) { cond.push("p.person_type = ?"); params.push(personType); }
  if (search) {
    // The search bar covers the person's Name and Contact Number only; "Added By" is its own filter (worker_id).
    cond.push("(p.name LIKE ? OR p.mobile LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like);
  }
  // "Direct" = came through the general link with no karyakarta behind it.
  if (source === "direct") cond.push("p.worker_id IS NULL");
  if (source === "worker") cond.push("p.worker_id IS NOT NULL");
  return { where: `WHERE ${cond.join(" AND ")}`, params };
}

// ---------------------------------------------------------------- SUMMARY
// The dashboard header: lifetime/period totals, worker counts, the top worker and
// the best ward, plus the four fixed period buckets shown as tiles.
export async function getRegSummary({ campaignId, from, to, ward, scope } = {}) {
  await ensureRegistrationSchema();

  const scoped = (extra = {}) => peopleFilters({ campaignId, ward, scope, ...extra });

  const countsFor = async (range) => {
    const f = scoped(range);
    const [row] = await query(
      `SELECT
         COUNT(*) AS total,
         SUM(p.person_type = 'voter') AS voters,
         SUM(p.person_type = 'worker') AS new_workers,
         SUM(p.worker_id IS NULL) AS direct
       ${PEOPLE_FROM} ${f.where}`,
      f.params
    );
    return {
      total: Number(row?.total || 0),
      voters: Number(row?.voters || 0),
      new_workers: Number(row?.new_workers || 0),
      direct: Number(row?.direct || 0),
    };
  };

  // Selected period (or lifetime when no period is set) + the fixed tiles.
  const period = await countsFor({ from, to });
  const lifetime = from || to ? await countsFor({}) : period;
  const buckets = {};
  for (const key of ["today", "yesterday", "week", "month"]) {
    buckets[key] = await countsFor(resolveRegPeriod(key));
  }

  // Worker roster counts (campaign-scoped; a ward filter narrows to that ward).
  const wCond = ["1 = 1"];
  const wParams = [];
  if (campaignId) { wCond.push("w.campaign_id = ?"); wParams.push(campaignId); }
  if (ward) { wCond.push("w.ward_number = ?"); wParams.push(ward); }
  const [wRow] = await query(
    `SELECT COUNT(*) AS total_workers, SUM(w.status = 'active') AS active_workers
       FROM reg_workers w WHERE ${wCond.join(" AND ")}`,
    wParams
  );

  // Top performer + best ward over the SELECTED period, so they answer "who is
  // winning right now", not only lifetime.
  const [topWorker] = await getWorkerRanking({ campaignId, from, to, ward, limit: 1 });
  const [topWard] = await getWardRanking({ campaignId, from, to, limit: 1 });

  return {
    period,
    lifetime,
    buckets,
    total_workers: Number(wRow?.total_workers || 0),
    active_workers: Number(wRow?.active_workers || 0),
    top_worker: topWorker || null,
    top_ward: topWard || null,
  };
}

// ------------------------------------------------------- WORKER RANKING
// Rank | Worker | Mobile | Voters Added | Workers Added | Total.
// LEFT JOIN from the worker side so a worker with zero registrations still
// appears (ranked last) — the roster is the denominator of the drive.
// The people-join / worker WHERE of the Worker-wise Performance dataset, shared by the ranking rows, its totals and its count so
// they are always computed over exactly the same workers. `workerIds` (from workerIdsForLocation) is the Lok Sabha / Assembly
// filter: null = no location filter, [] = nothing matches.
function workerRankingParts({ campaignId, from, to, ward, search, workerScope, workerIds }) {
  const on = ["p.worker_id = w.id", "p.status = 'active'"];
  const params = [];
  if (from) { on.push("p.registered_at >= ?"); params.push(`${from} 00:00:00`); }
  if (to) { on.push("p.registered_at < DATE_ADD(?, INTERVAL 1 DAY)"); params.push(`${to} 00:00:00`); }
  const where = ["1 = 1"];
  if (campaignId) { where.push("w.campaign_id = ?"); params.push(campaignId); }
  if (ward) { where.push("w.ward_number = ?"); params.push(ward); }
  if (search) { where.push("(w.name LIKE ? OR w.mobile LIKE ? OR w.worker_code LIKE ?)"); const l = `%${search}%`; params.push(l, l, l); }
  // Zone-wise access control: a caller sees only workers active in their territory.
  if (workerScope && workerScope.cond) { where.push(workerScope.cond); params.push(...(workerScope.params || [])); }
  if (Array.isArray(workerIds)) where.push(workerIds.length ? `w.id IN (${workerIds.map((n) => Number(n) || 0).join(",")})` : "1 = 0");
  return { on, where, params };
}

// Totals of the SAME dataset (every matching worker, not just the Top-N rows): workers, voters, workers added, total.
export async function getWorkerPerformanceTotals(opts = {}) {
  await ensureRegistrationSchema();
  const { on, where, params } = workerRankingParts(opts);
  const [r] = await query(
    `SELECT COUNT(DISTINCT w.id) AS workers,
            COALESCE(SUM(p.person_type = 'voter'), 0) AS voters,
            COALESCE(SUM(p.person_type = 'worker'), 0) AS new_workers,
            COUNT(p.id) AS total
       FROM reg_workers w LEFT JOIN reg_people p ON ${on.join(" AND ")}
      WHERE ${where.join(" AND ")}`,
    params
  );
  return { workers: Number(r?.workers || 0), voters: Number(r?.voters || 0), new_workers: Number(r?.new_workers || 0), total: Number(r?.total || 0) };
}

export async function getWorkerRanking({ campaignId, from, to, ward, limit = 10, offset = 0, search, workerScope, workerIds = null } = {}) {
  await ensureRegistrationSchema();

  // People-side conditions live in the JOIN (not WHERE) to preserve the LEFT JOIN.
  const { on, where, params } = workerRankingParts({ campaignId, from, to, ward, search, workerScope, workerIds });

  const lim = Math.min(500, Math.max(1, Number(limit) || 10));
  const off = Math.max(0, Number(offset) || 0);
  const rows = await query(
    `SELECT w.id, w.name, w.mobile, w.worker_code, w.ward_number, w.area_booth, w.status, w.token, w.contact_id,
            MAX(cc.photo_url)   AS contact_photo_url,
            MAX(cc.person_name) AS contact_name,
            COALESCE(SUM(p.person_type = 'voter'), 0) AS voters,
            COALESCE(SUM(p.person_type = 'worker'), 0) AS new_workers,
            COUNT(p.id) AS total
       FROM reg_workers w
       LEFT JOIN reg_people p ON ${on.join(" AND ")}
       LEFT JOIN contacts cc ON cc.id = w.contact_id
      WHERE ${where.join(" AND ")}
      GROUP BY w.id
      ORDER BY total DESC, voters DESC, w.name ASC, w.id ASC
      LIMIT ${lim} OFFSET ${off}`,
    params
  );
  // Rank is the position in this ordering; offset keeps it correct when paging.
  // A worker generated FROM a Contact carries that Contact's id + live photo/name,
  // so the roster (Workers Link) shows the same Contact photo without a re-upload.
  const loc = await workerContactLocations(rows);
  return rows.map((r, i) => ({
    rank: off + i + 1,
    id: r.id, name: r.name, mobile: r.mobile, worker_code: r.worker_code,
    // Lok Sabha / Assembly from the worker's Contact record (see workerContactLocations).
    lok_sabha_name: loc.get(r.id)?.lok_sabha_name || null,
    assembly_name: loc.get(r.id)?.assembly_name || null,
    location_contact_id: loc.get(r.id)?.contact_id || null,
    ward_number: r.ward_number, area_booth: r.area_booth, status: r.status, token: r.token,
    contact_id: r.contact_id || null,
    photo_url: r.contact_photo_url || null,
    contact_name: r.contact_name || null,
    voters: Number(r.voters), new_workers: Number(r.new_workers), total: Number(r.total),
  }));
}

// Lok Sabha + Assembly of each worker, read from the Contact page's own record. Lok Sabha = the contact's own Lok Sabha, else the
// Lok Sabha above its district (as the Contact List shows it), else the one above its Assembly's district - the real
// assembly -> district -> Lok Sabha hierarchy, never derived from the Zone. Assembly = the contact's assembly. Matched by:
//   1. reg_workers.contact_id — the worker↔Contact link (workers generated from a
//      Contact carry it), else
//   2. the worker's mobile (last 10 digits) when it belongs to EXACTLY ONE live
//      contact. Never by name. No match / no location → null ("—" on screen).
// Returns Map<worker id, { lok_sabha_id, lok_sabha_name, assembly_id, assembly_name, contact_id }>.
async function workerContactLocations(rows) {
  const out = new Map();
  if (!rows.length) return out;
  const LOC_SELECT = `c.id, COALESCE(cls.id, lls.id, als.id) AS lok_sabha_id, COALESCE(cls.name, lls.name, als.name) AS lok_sabha_name,
         c.assembly_id AS assembly_id, la.name AS assembly_name
         FROM contacts c
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations lls ON lls.id = ld.parent_id AND lls.type = 'lok_sabha'
         LEFT JOIN locations cls ON cls.id = c.lok_sabha_id AND cls.type = 'lok_sabha'
         LEFT JOIN locations la ON la.id = c.assembly_id
         LEFT JOIN locations lad ON lad.id = la.parent_id
         LEFT JOIN locations als ON als.id = lad.parent_id AND als.type = 'lok_sabha'`;
  const ids = [...new Set(rows.map((r) => r.contact_id).filter(Boolean).map(Number))];
  const byId = new Map();
  if (ids.length) {
    for (const c of await query(`SELECT ${LOC_SELECT} WHERE c.id IN (${ids.map(() => "?").join(",")})`, ids)) byId.set(Number(c.id), c);
  }
  // Workers without a (still existing) linked Contact: unique match by mobile.
  const pending = rows.filter((r) => !(r.contact_id && byId.has(Number(r.contact_id))));
  const keys = [...new Set(pending.map((r) => phoneKey(r.mobile)).filter((k) => k && k.length === 10))];
  const byKey = new Map();
  if (keys.length) {
    const live = await notPendingClause("c");
    const found = await query(
      `SELECT ${LOC_SELECT.replace("c.id,", `c.id, ${last10Sql("c.phone_number")} AS k,`)}
        WHERE ${last10Sql("c.phone_number")} IN (${keys.map(() => "?").join(",")})${live}`,
      keys
    );
    const count = new Map();
    for (const c of found) count.set(c.k, (count.get(c.k) || 0) + 1);
    for (const c of found) if (count.get(c.k) === 1) byKey.set(c.k, c);
  }
  for (const r of rows) {
    const c = (r.contact_id && byId.get(Number(r.contact_id))) || byKey.get(phoneKey(r.mobile));
    if (c) out.set(r.id, { lok_sabha_id: c.lok_sabha_id ? Number(c.lok_sabha_id) : null, lok_sabha_name: c.lok_sabha_name || null, assembly_id: c.assembly_id && c.assembly_name ? Number(c.assembly_id) : null, assembly_name: c.assembly_name || null, contact_id: Number(c.id) });
  }
  return out;
}

// The Lok Sabha / Assembly filter of Worker-wise Performance. Returns null when no location filter is chosen, else the ids of the
// workers (campaign + access scope applied) whose mapped Lok Sabha AND/OR Assembly equal the chosen ids - the same mapping the
// table's columns show, resolved on the unique worker id (contact link, else a unique mobile), never by name. The filter is applied
// to the underlying query (not the loaded rows), so every matching worker is included. When both are chosen the Assembly must
// belong to that Lok Sabha in the real hierarchy, otherwise nothing matches.
export async function workerIdsForLocation({ campaignId, lokSabhaId, assemblyId, workerScope } = {}) {
  if (!lokSabhaId && !assemblyId) return null;
  if (lokSabhaId && assemblyId) {
    const [a] = await query(
      `SELECT ls.id AS lok_sabha_id FROM locations a JOIN locations d ON d.id = a.parent_id JOIN locations ls ON ls.id = d.parent_id AND ls.type = 'lok_sabha'
        WHERE a.id = ? AND a.type = 'assembly'`, [assemblyId]);
    if (!a || Number(a.lok_sabha_id) !== Number(lokSabhaId)) return [];
  }
  const where = ["1 = 1"], params = [];
  if (campaignId) { where.push("w.campaign_id = ?"); params.push(campaignId); }
  if (workerScope && workerScope.cond) { where.push(workerScope.cond); params.push(...(workerScope.params || [])); }
  const workers = await query(`SELECT w.id, w.mobile, w.contact_id FROM reg_workers w WHERE ${where.join(" AND ")}`, params);
  const loc = await workerContactLocations(workers);
  return workers.filter((w) => {
    const l = loc.get(w.id);
    if (!l) return false;
    if (lokSabhaId && Number(l.lok_sabha_id) !== Number(lokSabhaId)) return false;
    if (assemblyId && Number(l.assembly_id) !== Number(assemblyId)) return false;
    return true;
  }).map((w) => w.id);
}

// Lok Sabha and Assembly options from the Master Data (locations), each Assembly with the Lok Sabha above it (assembly -> district ->
// Lok Sabha) so the Assembly list can follow the chosen Lok Sabha.
export async function getLocationFilterOptions() {
  const lok = await query(`SELECT id, name FROM locations WHERE type = 'lok_sabha' ORDER BY name`);
  const asm = await query(
    `SELECT a.id, a.name, ls.id AS lok_sabha_id FROM locations a
       LEFT JOIN locations d ON d.id = a.parent_id
       LEFT JOIN locations ls ON ls.id = d.parent_id AND ls.type = 'lok_sabha'
      WHERE a.type = 'assembly' ORDER BY a.name`
  );
  return { lok_sabhas: lok.map((r) => ({ id: r.id, name: r.name })), assemblies: asm.map((r) => ({ id: r.id, name: r.name, lok_sabha_id: r.lok_sabha_id || null })) };
}

export async function countWorkers({ campaignId, ward, search, workerScope } = {}) {
  await ensureRegistrationSchema();
  const where = ["1 = 1"];
  const params = [];
  if (campaignId) { where.push("campaign_id = ?"); params.push(campaignId); }
  if (ward) { where.push("ward_number = ?"); params.push(ward); }
  if (search) { where.push("(name LIKE ? OR mobile LIKE ? OR worker_code LIKE ?)"); const l = `%${search}%`; params.push(l, l, l); }
  // Zone-wise access control (same rule as getWorkerRanking). Alias is reg_workers
  // itself here (no table alias), so scope on the bare row via a correlated EXISTS.
  if (workerScope && workerScope.cond) { where.push(workerScope.cond.replace(/\bw\./g, "reg_workers.")); params.push(...(workerScope.params || [])); }
  const [row] = await query(`SELECT COUNT(*) AS total FROM reg_workers WHERE ${where.join(" AND ")}`, params);
  return Number(row?.total || 0);
}

// --------------------------------------------------------- WARD RANKING
// Rank | Ward No. | Voters Added | Workers Added | Total. Rows with no resolvable
// ward at all are grouped out (they'd be a meaningless "" bucket).
export async function getWardRanking({ campaignId, from, to, limit = 20, offset = 0, scope } = {}) {
  await ensureRegistrationSchema();
  const f = peopleFilters({ campaignId, from, to, scope });
  const lim = Math.min(500, Math.max(1, Number(limit) || 20));
  const off = Math.max(0, Number(offset) || 0);
  const rows = await query(
    `SELECT ${WARD_EXPR} AS ward_number,
            SUM(p.person_type = 'voter') AS voters,
            SUM(p.person_type = 'worker') AS new_workers,
            COUNT(*) AS total
       ${PEOPLE_FROM} ${f.where} AND ${WARD_EXPR} IS NOT NULL
      GROUP BY ward_number
      ORDER BY total DESC, voters DESC, ward_number ASC
      LIMIT ${lim} OFFSET ${off}`,
    f.params
  );
  return rows.map((r, i) => ({
    rank: off + i + 1,
    ward_number: r.ward_number,
    voters: Number(r.voters), new_workers: Number(r.new_workers), total: Number(r.total),
  }));
}

// --------------------------------------------------------- BLOCK RANKING (§9B)
// Rank | Block (Area / Booth) | Voters | Workers | Total. Groups performance by the
// BLOCK (area_booth) — NOT the ward — using the existing registration metric, sorted
// highest→lowest with a deterministic tie-break (block name) so the order is stable
// across refreshes. Rows with no resolvable block are excluded (a meaningless "").
export async function getBlockRanking({ campaignId, from, to, limit = 100, offset = 0, scope } = {}) {
  await ensureRegistrationSchema();
  const f = peopleFilters({ campaignId, from, to, scope });
  const lim = Math.min(500, Math.max(1, Number(limit) || 100));
  const off = Math.max(0, Number(offset) || 0);
  const rows = await query(
    `SELECT ${BLOCK_EXPR} AS block,
            SUM(p.person_type = 'voter') AS voters,
            SUM(p.person_type = 'worker') AS new_workers,
            COUNT(*) AS total
       ${PEOPLE_FROM} ${f.where} AND ${BLOCK_EXPR} IS NOT NULL
      GROUP BY block
      ORDER BY total DESC, voters DESC, block ASC
      LIMIT ${lim} OFFSET ${off}`,
    f.params
  );
  return rows.map((r, i) => ({
    rank: off + i + 1,
    block: r.block,
    voters: Number(r.voters), new_workers: Number(r.new_workers), total: Number(r.total),
  }));
}

// ------------------------------------------------------ REGISTRATION LIST
// The full "which worker added which person" table — every row carries its
// collecting worker's name/code, so attribution is visible without a second look-up.
const PEOPLE_SORTS = {
  newest: "p.registered_at DESC, p.id DESC",
  oldest: "p.registered_at ASC, p.id ASC",
  name_az: "p.name ASC",
  name_za: "p.name DESC",
  worker: "w.name ASC, p.registered_at DESC",
  ward: "p.ward_number ASC, p.registered_at DESC",
  // Karyakarta Rating (marks out of 10), highest first — compared as a NUMBER
  // (CAST, never the text), unrated last; equal marks keep newest-first, then id.
  marks: "(p.worker_rating IS NULL) ASC, CAST(p.worker_rating AS DECIMAL(5,2)) DESC, p.registered_at DESC, p.id DESC",
};
// SQL ORDER BY for the marks sort, for queries outside getPeoplePage.
export const MARKS_ORDER_SQL = PEOPLE_SORTS.marks;

// Default list order: a Worker list is ranked by marks; any other list stays newest-first.
export function defaultPeopleSort(personType) {
  return personType === "worker" ? "marks" : "newest";
}

export async function getPeoplePage(filters = {}) {
  await ensureRegistrationSchema();
  await ensureConvertSchema(); // converted_contact_id / converted_at on each row
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(filters.pageSize) || 25));
  const offset = (page - 1) * pageSize;
  const f = peopleFilters(filters);
  // Records nobody has called / messaged / WhatsApp'd yet come first; the chosen
  // sort then orders each group.
  const orderBy = `${UNCONTACTED_FIRST_SQL}, ${PEOPLE_SORTS[filters.sort] || PEOPLE_SORTS.newest}`;

  const [{ total }] = await query(`SELECT COUNT(*) AS total ${PEOPLE_FROM} ${f.where}`, f.params);
  // pageSize/offset are clamped integers above — mysql2's execute() rejects
  // placeholders in LIMIT/OFFSET, so they are inlined rather than bound.
  const rows = await query(
    `SELECT p.*, ${WARD_EXPR} AS effective_ward,
            w.name AS worker_name, w.mobile AS worker_mobile, w.worker_code AS worker_code
       ${PEOPLE_FROM} ${f.where}
      ORDER BY ${orderBy}
      LIMIT ${pageSize} OFFSET ${offset}`,
    f.params
  );
  return {
    // convert_eligible: the SAME rule the convert API enforces (Worker, counted,
    // rated 6/10+, not yet converted) — drives the "Convert to Contact" button.
    people: rows.map((r) => ({ ...r, convert_eligible: isConvertEligible(r) })),
    total: Number(total || 0),
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(Number(total || 0) / pageSize)),
  };
}

// Distinct ward values in use — powers the ward filter dropdown.
export async function getWardOptions(campaignId, scope) {
  await ensureRegistrationSchema();
  // Scoped caller: the dropdown must only offer wards inside their territory, so it
  // is built from the in-scope people alone (never other zones' ward numbers).
  if (scope && scope.cond) {
    const cond = ["TRIM(p.ward_number) <> ''", "p.ward_number IS NOT NULL", scope.cond];
    const params = [...(scope.params || [])];
    if (campaignId) { cond.unshift("p.campaign_id = ?"); params.unshift(campaignId); }
    const rows = await query(
      `SELECT DISTINCT p.ward_number FROM reg_people p WHERE ${cond.join(" AND ")} ORDER BY p.ward_number ASC`,
      params
    );
    return rows.map((r) => r.ward_number);
  }
  const params = [];
  let where = "";
  if (campaignId) { where = "WHERE campaign_id = ?"; params.push(campaignId); }
  const rows = await query(
    `SELECT DISTINCT ward_number FROM (
        SELECT ward_number, campaign_id FROM reg_people
        UNION ALL
        SELECT ward_number, campaign_id FROM reg_workers
     ) t ${where}
     ${where ? "AND" : "WHERE"} ward_number IS NOT NULL AND TRIM(ward_number) <> ''
     ORDER BY ward_number ASC`,
    params
  );
  return rows.map((r) => r.ward_number);
}

// ------------------------------------------------------- ASSEMBLY-WISE (§8)
// Voter + Worker registration counts for EVERY assembly (all 90), from live data.
// Active registrations are grouped by assembly_id, then LEFT-joined against the
// full assembly master (locations type='assembly') so an assembly with no
// registrations still appears with 0/0 — never dropped, never hardcoded. Honors
// the drive/date filters so the graph matches the rest of the dashboard.
export async function getAssemblyRegistrationCounts({ campaignId, from, to, scope } = {}) {
  await ensureRegistrationSchema();
  const { where, params } = peopleFilters({ campaignId, from, to, scope });
  const counts = await query(
    `SELECT p.assembly_id AS id,
            SUM(p.person_type = 'voter')  AS voters,
            SUM(p.person_type = 'worker') AS workers
       ${PEOPLE_FROM} ${where} AND p.assembly_id IS NOT NULL
      GROUP BY p.assembly_id`,
    params
  );
  const byId = new Map(counts.map((r) => [Number(r.id), { voters: Number(r.voters) || 0, workers: Number(r.workers) || 0 }]));
  // Full assembly master — English name plus a Hindi name when the column exists
  // (so the caller can show either language). Ordered by name for a stable graph.
  const hiCol = await assemblyHindiColumn();
  const hiExpr = hiCol ? `COALESCE(NULLIF(TRIM(\`${hiCol}\`), ''), name)` : "name";
  const assemblies = await query(
    `SELECT id, name AS name, ${hiExpr} AS name_hi FROM locations WHERE type = 'assembly' ORDER BY name ASC`
  );
  return assemblies.map((a) => {
    const c = byId.get(Number(a.id)) || { voters: 0, workers: 0 };
    return { id: a.id, name: a.name, name_hi: a.name_hi, voters: c.voters, workers: c.workers };
  });
}

// Detect a Hindi assembly-name column on `locations` once per process (mirrors the
// public form's detection); returns the column name or null.
let _asmHiCol; // undefined = not probed, null = none, string = column
async function assemblyHindiColumn() {
  if (_asmHiCol !== undefined) return _asmHiCol;
  try {
    const rows = await query(
      `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations'
          AND COLUMN_NAME IN ('name_hi','name_hindi','hindi_name','name_hn')`
    );
    _asmHiCol = rows.length ? rows[0].c : null;
  } catch { _asmHiCol = null; }
  return _asmHiCol;
}
