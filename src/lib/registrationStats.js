import { query } from "@/lib/db";
import { ensureRegistrationSchema, resolveRegPeriod } from "@/lib/registrationSchema";

// Server-side aggregation for the Voter & Worker Registration dashboard. Every
// number is computed in SQL (COUNT / GROUP BY) so the client never pulls raw rows
// to add them up. Only status='active' people count — the single "successful
// registration" definition, so duplicates/rejects never inflate a ranking.
//
// A registration's ward is the ward typed on the form; when the form left it
// blank it falls back to the collecting worker's ward, so ward-wise totals stay
// complete rather than dropping rows into an "unknown" bucket.
const WARD_EXPR = "NULLIF(TRIM(COALESCE(NULLIF(TRIM(p.ward_number),''), w.ward_number, '')),'')";

// WHERE fragment shared by every people-side query.
function peopleFilters({ campaignId, from, to, ward, workerId, personType, status, search }) {
  const cond = ["p.status = ?"];
  const params = [status || "active"];
  if (campaignId) { cond.push("p.campaign_id = ?"); params.push(campaignId); }
  if (from) { cond.push("p.registered_at >= ?"); params.push(`${from} 00:00:00`); }
  if (to) { cond.push("p.registered_at < DATE_ADD(?, INTERVAL 1 DAY)"); params.push(`${to} 00:00:00`); }
  if (ward) { cond.push(`${WARD_EXPR} = ?`); params.push(ward); }
  if (workerId) { cond.push("p.worker_id = ?"); params.push(workerId); }
  if (personType) { cond.push("p.person_type = ?"); params.push(personType); }
  if (search) {
    cond.push("(p.name LIKE ? OR p.mobile LIKE ? OR p.address LIKE ? OR w.name LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  return { where: `WHERE ${cond.join(" AND ")}`, params };
}

// Every people query joins its worker — attribution is the point of the module,
// and the join also supplies the ward fallback above.
const PEOPLE_FROM = "FROM reg_people p JOIN reg_workers w ON w.id = p.worker_id";

// ---------------------------------------------------------------- SUMMARY
// The dashboard header: lifetime/period totals, worker counts, the top worker and
// the best ward, plus the four fixed period buckets shown as tiles.
export async function getRegSummary({ campaignId, from, to, ward } = {}) {
  await ensureRegistrationSchema();

  const scoped = (extra = {}) => peopleFilters({ campaignId, ward, ...extra });

  const countsFor = async (range) => {
    const f = scoped(range);
    const [row] = await query(
      `SELECT
         COUNT(*) AS total,
         SUM(p.person_type = 'voter') AS voters,
         SUM(p.person_type = 'worker') AS new_workers
       ${PEOPLE_FROM} ${f.where}`,
      f.params
    );
    return {
      total: Number(row?.total || 0),
      voters: Number(row?.voters || 0),
      new_workers: Number(row?.new_workers || 0),
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
export async function getWorkerRanking({ campaignId, from, to, ward, limit = 10, offset = 0, search } = {}) {
  await ensureRegistrationSchema();

  // People-side conditions live in the JOIN (not WHERE) to preserve the LEFT JOIN.
  const on = ["p.worker_id = w.id", "p.status = 'active'"];
  const params = [];
  if (from) { on.push("p.registered_at >= ?"); params.push(`${from} 00:00:00`); }
  if (to) { on.push("p.registered_at < DATE_ADD(?, INTERVAL 1 DAY)"); params.push(`${to} 00:00:00`); }

  const where = ["1 = 1"];
  if (campaignId) { where.push("w.campaign_id = ?"); params.push(campaignId); }
  if (ward) { where.push("w.ward_number = ?"); params.push(ward); }
  if (search) { where.push("(w.name LIKE ? OR w.mobile LIKE ? OR w.worker_code LIKE ?)"); const l = `%${search}%`; params.push(l, l, l); }

  const lim = Math.min(500, Math.max(1, Number(limit) || 10));
  const off = Math.max(0, Number(offset) || 0);
  const rows = await query(
    `SELECT w.id, w.name, w.mobile, w.worker_code, w.ward_number, w.area_booth, w.status, w.token,
            COALESCE(SUM(p.person_type = 'voter'), 0) AS voters,
            COALESCE(SUM(p.person_type = 'worker'), 0) AS new_workers,
            COUNT(p.id) AS total
       FROM reg_workers w
       LEFT JOIN reg_people p ON ${on.join(" AND ")}
      WHERE ${where.join(" AND ")}
      GROUP BY w.id
      ORDER BY total DESC, voters DESC, w.name ASC
      LIMIT ${lim} OFFSET ${off}`,
    params
  );
  // Rank is the position in this ordering; offset keeps it correct when paging.
  return rows.map((r, i) => ({
    rank: off + i + 1,
    id: r.id, name: r.name, mobile: r.mobile, worker_code: r.worker_code,
    ward_number: r.ward_number, area_booth: r.area_booth, status: r.status, token: r.token,
    voters: Number(r.voters), new_workers: Number(r.new_workers), total: Number(r.total),
  }));
}

export async function countWorkers({ campaignId, ward, search } = {}) {
  await ensureRegistrationSchema();
  const where = ["1 = 1"];
  const params = [];
  if (campaignId) { where.push("campaign_id = ?"); params.push(campaignId); }
  if (ward) { where.push("ward_number = ?"); params.push(ward); }
  if (search) { where.push("(name LIKE ? OR mobile LIKE ? OR worker_code LIKE ?)"); const l = `%${search}%`; params.push(l, l, l); }
  const [row] = await query(`SELECT COUNT(*) AS total FROM reg_workers WHERE ${where.join(" AND ")}`, params);
  return Number(row?.total || 0);
}

// --------------------------------------------------------- WARD RANKING
// Rank | Ward No. | Voters Added | Workers Added | Total. Rows with no resolvable
// ward at all are grouped out (they'd be a meaningless "" bucket).
export async function getWardRanking({ campaignId, from, to, limit = 20, offset = 0 } = {}) {
  await ensureRegistrationSchema();
  const f = peopleFilters({ campaignId, from, to });
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
};

export async function getPeoplePage(filters = {}) {
  await ensureRegistrationSchema();
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(filters.pageSize) || 25));
  const offset = (page - 1) * pageSize;
  const f = peopleFilters(filters);
  const orderBy = PEOPLE_SORTS[filters.sort] || PEOPLE_SORTS.newest;

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
    people: rows,
    total: Number(total || 0),
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(Number(total || 0) / pageSize)),
  };
}

// Distinct ward values in use — powers the ward filter dropdown.
export async function getWardOptions(campaignId) {
  await ensureRegistrationSchema();
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
