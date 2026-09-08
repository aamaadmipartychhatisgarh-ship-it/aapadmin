import { query } from "@/lib/db";
import { ensureMembershipSchema, resolvePeriod } from "@/lib/membershipSchema";

// Server-side aggregation for the Worker & Membership dashboard. Every statistic
// is computed in SQL (COUNT / GROUP BY / window RANK) so the client never pulls
// raw rows to add them up (§33, §38). Only status='active' members count — the
// one consistent "successful member" definition (§30).
//
// Geography note: this product's location hierarchy is
//   zone → lok_sabha → district → assembly → ward → booth
// and the UI label "Block" maps to the `ward` type (there is no separate block
// level). So `wardId` here is what the dashboard shows as "Block / Ward".

// Build an inclusive registration-date clause on a member alias. `to` covers the
// whole day via < (to + 1 day). Returns {cond, params} where cond starts with AND.
function memberDateClause(from, to, alias = "m") {
  const parts = [];
  const params = [];
  if (from) { parts.push(`${alias}.registered_at >= ?`); params.push(`${from} 00:00:00`); }
  if (to) { parts.push(`${alias}.registered_at < DATE_ADD(?, INTERVAL 1 DAY)`); params.push(`${to} 00:00:00`); }
  return { cond: parts.length ? " AND " + parts.join(" AND ") : "", params };
}

// Geo filters that apply to the MEMBER row (used in member list / growth / totals).
function memberGeoClause({ assemblyId, wardId, boothId }, alias = "m") {
  const parts = []; const params = [];
  if (assemblyId) { parts.push(`${alias}.assembly_id = ?`); params.push(assemblyId); }
  if (wardId) { parts.push(`${alias}.ward_id = ?`); params.push(wardId); }
  if (boothId) { parts.push(`${alias}.booth_id = ?`); params.push(boothId); }
  return { cond: parts.length ? " AND " + parts.join(" AND ") : "", params };
}

// ---------------------------------------------------------------- SUMMARY
export async function getSummary({ from, to, assemblyId, wardId, boothId } = {}) {
  await ensureMembershipSchema();
  const geo = memberGeoClause({ assemblyId, wardId, boothId });
  const period = memberDateClause(from, to);

  // Worker-side counts (respect worker geo filters).
  const wParts = []; const wParams = [];
  if (assemblyId) { wParts.push("w.assembly_id = ?"); wParams.push(assemblyId); }
  if (wardId) { wParts.push("w.ward_id = ?"); wParams.push(wardId); }
  if (boothId) { wParts.push("w.booth_id = ?"); wParams.push(boothId); }
  const wWhere = wParts.length ? "WHERE " + wParts.join(" AND ") : "";

  const [{ total_workers }] = await query(`SELECT COUNT(*) AS total_workers FROM workers w ${wWhere}`, wParams);
  const [{ active_workers }] = await query(
    `SELECT COUNT(*) AS active_workers FROM workers w ${wWhere ? wWhere + " AND" : "WHERE"} w.status = 'active'`, wParams
  );

  // Members in the selected period + geo (lifetime = no period clause).
  const [{ period_members }] = await query(
    `SELECT COUNT(*) AS period_members FROM members m WHERE m.status='active'${period.cond}${geo.cond}`,
    [...period.params, ...geo.params]
  );
  const [{ lifetime_members }] = await query(
    `SELECT COUNT(*) AS lifetime_members FROM members m WHERE m.status='active'${geo.cond}`, geo.params
  );

  // Workers with ≥1 member (in period+geo) vs zero. Count distinct worker_ids
  // present in the filtered member set, intersected with the worker geo filter.
  const [{ workers_with }] = await query(
    `SELECT COUNT(DISTINCT m.worker_id) AS workers_with
       FROM members m JOIN workers w ON w.id = m.worker_id
      WHERE m.status='active'${period.cond}${geo.cond}`,
    [...period.params, ...geo.params]
  );
  const workersWith = Number(workers_with) || 0;
  const totalWorkers = Number(total_workers) || 0;
  const activeWorkers = Number(active_workers) || 0;
  const workersZero = Math.max(0, totalWorkers - workersWith);
  const avg = activeWorkers > 0 ? Number(period_members) / activeWorkers : 0;

  return {
    totalWorkers,
    activeWorkers,
    periodMembers: Number(period_members) || 0,
    lifetimeMembers: Number(lifetime_members) || 0,
    workersWithMembers: workersWith,
    workersWithZero: workersZero,
    avgMembersPerWorker: Math.round(avg * 100) / 100,
  };
}

// ------------------------------------------------------- WORKER RANK CORE
// Per-worker aggregate + GLOBAL rank (computed before worker/search filters so
// "Current Rank" is a true global position). Tie-break: equal counts → the worker
// who REACHED that count earlier (earlier last member timestamp) ranks higher,
// then id — fully deterministic, stable across refreshes (§13, §14).
function rankedWorkersSubquery(from, to) {
  const d = memberDateClause(from, to, "m");
  const sql = `
    SELECT r.*,
      RANK() OVER (ORDER BY r.member_count DESC, r.last_member_at IS NULL ASC, r.last_member_at ASC, r.id ASC) AS rnk
    FROM (
      SELECT w.id, w.name, w.worker_code, w.mobile, w.photo_url, w.position, w.status AS worker_status,
             w.assembly_id, w.ward_id, w.booth_id,
             asm.name AS assembly_name, wd.name AS ward_name, bo.name AS booth_name,
             COUNT(m.id) AS member_count, MAX(m.registered_at) AS last_member_at
        FROM workers w
        LEFT JOIN locations asm ON asm.id = w.assembly_id
        LEFT JOIN locations wd  ON wd.id  = w.ward_id
        LEFT JOIN locations bo  ON bo.id  = w.booth_id
        LEFT JOIN members m ON m.worker_id = w.id AND m.status='active'${d.cond}
        GROUP BY w.id
    ) r`;
  return { sql, params: d.params };
}

const WORKER_SORTS = {
  members: "member_count",
  rank: "rnk",
  name: "name",
  assembly: "assembly_name",
  ward: "ward_name",
  last_activity: "last_member_at",
};

// ---------------------------------------------------------- WORKER TABLE
export async function getWorkersPage({
  from, to, assemblyId, wardId, boothId, search,
  workerStatus, membership, // membership: 'with' | 'zero'
  page = 1, pageSize = 20, sort = "members", dir = "desc",
} = {}) {
  await ensureMembershipSchema();
  const base = rankedWorkersSubquery(from, to);

  const where = []; const params = [...base.params];
  if (assemblyId) { where.push("t.assembly_id = ?"); params.push(assemblyId); }
  if (wardId) { where.push("t.ward_id = ?"); params.push(wardId); }
  if (boothId) { where.push("t.booth_id = ?"); params.push(boothId); }
  if (workerStatus) { where.push("t.worker_status = ?"); params.push(workerStatus); }
  if (membership === "with") where.push("t.member_count > 0");
  if (membership === "zero") where.push("t.member_count = 0");
  if (search && search.trim()) {
    where.push("(t.name LIKE ? OR t.worker_code LIKE ? OR t.mobile LIKE ?)");
    const like = `%${search.trim()}%`; params.push(like, like, like);
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const sortCol = WORKER_SORTS[sort] || "member_count";
  const dirSql = dir === "asc" ? "ASC" : "DESC";
  const limit = Math.min(100, Math.max(1, pageSize));
  const offset = (Math.max(1, page) - 1) * limit;

  // Count matching workers (rank not needed for the count).
  const countInner = rankedWorkersSubquery(from, to); // same aggregate, no window needed but reuse
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM (${countInner.sql}) t ${whereSql}`,
    [...countInner.params, ...params.slice(base.params.length)]
  );

  const rows = await query(
    `SELECT * FROM (${base.sql}) t ${whereSql} ORDER BY ${sortCol} ${dirSql}, t.rnk ASC LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  return {
    workers: rows.map((r) => ({
      id: r.id, name: r.name, worker_code: r.worker_code, mobile: r.mobile, photo_url: r.photo_url,
      position: r.position, worker_status: r.worker_status,
      assembly_id: r.assembly_id, ward_id: r.ward_id, booth_id: r.booth_id,
      assembly_name: r.assembly_name, ward_name: r.ward_name, booth_name: r.booth_name,
      member_count: Number(r.member_count) || 0, rank: Number(r.rnk) || null,
      last_member_at: r.last_member_at,
    })),
    total: Number(total) || 0,
    page: Math.max(1, page), pageSize: limit,
    pages: Math.max(1, Math.ceil((Number(total) || 0) / limit)),
  };
}

// -------------------------------------------------------------- RANKING
export async function getRanking({ from, to, assemblyId, wardId, boothId, limit = 200 } = {}) {
  const res = await getWorkersPage({
    from, to, assemblyId, wardId, boothId,
    page: 1, pageSize: Math.min(200, limit), sort: "rank", dir: "asc",
  });
  return res.workers;
}

// --------------------------------------------------------------- GROWTH
export async function getGrowth({ from, to, assemblyId, wardId, boothId, bucket = "day" } = {}) {
  await ensureMembershipSchema();
  const period = memberDateClause(from, to);
  const geo = memberGeoClause({ assemblyId, wardId, boothId });
  const expr = bucket === "month" ? "DATE_FORMAT(m.registered_at, '%Y-%m')"
    : bucket === "week" ? "DATE_FORMAT(m.registered_at, '%x-W%v')"
    : "DATE(m.registered_at)";
  const rows = await query(
    `SELECT ${expr} AS bucket, COUNT(*) AS cnt
       FROM members m
      WHERE m.status='active'${period.cond}${geo.cond}
      GROUP BY bucket ORDER BY bucket ASC`,
    [...period.params, ...geo.params]
  );
  // Running cumulative total alongside the per-bucket count.
  let running = 0;
  return rows.map((r) => { running += Number(r.cnt) || 0; return { bucket: String(r.bucket), members: Number(r.cnt) || 0, cumulative: running }; });
}

// ------------------------------------------------ ASSEMBLY / WARD BREAKDOWN
export async function getAssemblyBreakdown({ from, to } = {}) {
  await ensureMembershipSchema();
  const d = memberDateClause(from, to, "m");
  const rows = await query(
    `SELECT w.assembly_id AS id, asm.name AS name,
            COUNT(DISTINCT w.id) AS total_workers,
            COUNT(DISTINCT CASE WHEN w.status='active' THEN w.id END) AS active_workers,
            COUNT(DISTINCT CASE WHEN m.id IS NOT NULL THEN w.id END) AS workers_with,
            COUNT(m.id) AS total_members
       FROM workers w
       LEFT JOIN locations asm ON asm.id = w.assembly_id
       LEFT JOIN members m ON m.worker_id = w.id AND m.status='active'${d.cond}
      GROUP BY w.assembly_id
      ORDER BY total_members DESC, total_workers DESC`,
    d.params
  );
  return rows.map((r, i) => decorateGroup(r, i));
}

export async function getWardBreakdown({ from, to, assemblyId } = {}) {
  await ensureMembershipSchema();
  const d = memberDateClause(from, to, "m");
  const wParts = []; const wParams = [];
  if (assemblyId) { wParts.push("w.assembly_id = ?"); wParams.push(assemblyId); }
  const wWhere = wParts.length ? "WHERE " + wParts.join(" AND ") : "";
  const rows = await query(
    `SELECT w.ward_id AS id, wd.name AS name, asm.name AS assembly_name,
            COUNT(DISTINCT w.id) AS total_workers,
            COUNT(DISTINCT CASE WHEN w.status='active' THEN w.id END) AS active_workers,
            COUNT(DISTINCT CASE WHEN m.id IS NOT NULL THEN w.id END) AS workers_with,
            COUNT(m.id) AS total_members
       FROM workers w
       LEFT JOIN locations wd  ON wd.id  = w.ward_id
       LEFT JOIN locations asm ON asm.id = w.assembly_id
       LEFT JOIN members m ON m.worker_id = w.id AND m.status='active'${d.cond}
       ${wWhere}
      GROUP BY w.ward_id
      ORDER BY total_members DESC, total_workers DESC`,
    [...wParams, ...d.params]
  );
  return rows.map((r, i) => decorateGroup(r, i));
}

function decorateGroup(r, i) {
  const totalWorkers = Number(r.total_workers) || 0;
  const activeWorkers = Number(r.active_workers) || 0;
  const workersWith = Number(r.workers_with) || 0;
  const totalMembers = Number(r.total_members) || 0;
  return {
    id: r.id, name: r.name || (r.id ? `#${r.id}` : "Unassigned"),
    assembly_name: r.assembly_name,
    total_workers: totalWorkers, active_workers: activeWorkers,
    total_members: totalMembers,
    workers_with_members: workersWith,
    workers_with_zero: Math.max(0, totalWorkers - workersWith),
    avg_members: activeWorkers > 0 ? Math.round((totalMembers / activeWorkers) * 100) / 100 : 0,
    rank: i + 1,
  };
}

// ----------------------------------------------------------- MEMBER LIST
export async function getMembersPage({
  from, to, assemblyId, wardId, boothId, search, workerId,
  certificate, whatsapp, sms,
  page = 1, pageSize = 20,
} = {}) {
  await ensureMembershipSchema();
  const where = ["m.status='active'"]; const params = [];
  const period = memberDateClause(from, to); where.push(period.cond.replace(/^ AND /, "") || "1=1"); if (period.cond) params.push(...period.params);
  const geo = memberGeoClause({ assemblyId, wardId, boothId }); if (geo.cond) { where.push(geo.cond.replace(/^ AND /, "")); params.push(...geo.params); }
  if (workerId) { where.push("m.worker_id = ?"); params.push(workerId); }
  if (certificate) { where.push("m.certificate_status = ?"); params.push(certificate); }
  if (whatsapp) { where.push("m.whatsapp_status = ?"); params.push(whatsapp); }
  if (sms) { where.push("m.sms_status = ?"); params.push(sms); }
  if (search && search.trim()) {
    where.push("(m.name LIKE ? OR m.mobile LIKE ? OR m.membership_id LIKE ? OR w.name LIKE ? OR w.worker_code LIKE ?)");
    const like = `%${search.trim()}%`; params.push(like, like, like, like, like);
  }
  const whereSql = "WHERE " + where.filter(Boolean).join(" AND ");
  const limit = Math.min(100, Math.max(1, pageSize));
  const offset = (Math.max(1, page) - 1) * limit;

  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM members m LEFT JOIN workers w ON w.id = m.worker_id ${whereSql}`, params
  );
  const rows = await query(
    `SELECT m.*, w.name AS worker_name, w.worker_code,
            asm.name AS assembly_name, wd.name AS ward_name, bo.name AS booth_name
       FROM members m
       LEFT JOIN workers w ON w.id = m.worker_id
       LEFT JOIN locations asm ON asm.id = m.assembly_id
       LEFT JOIN locations wd  ON wd.id  = m.ward_id
       LEFT JOIN locations bo  ON bo.id  = m.booth_id
       ${whereSql}
      ORDER BY m.registered_at DESC, m.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  return {
    members: rows,
    total: Number(total) || 0,
    page: Math.max(1, page), pageSize: limit,
    pages: Math.max(1, Math.ceil((Number(total) || 0) / limit)),
  };
}

export async function getMemberDetail(id) {
  await ensureMembershipSchema();
  const [row] = await query(
    `SELECT m.*, w.name AS worker_name, w.worker_code, w.mobile AS worker_mobile,
            asm.name AS assembly_name, wd.name AS ward_name, bo.name AS booth_name
       FROM members m
       LEFT JOIN workers w ON w.id = m.worker_id
       LEFT JOIN locations asm ON asm.id = m.assembly_id
       LEFT JOIN locations wd  ON wd.id  = m.ward_id
       LEFT JOIN locations bo  ON bo.id  = m.booth_id
      WHERE m.id = ?`, [id]
  );
  return row || null;
}

// -------------------------------------------------- INDIVIDUAL WORKER VIEW
export async function getWorkerDetail(id) {
  await ensureMembershipSchema();
  const [w] = await query(
    `SELECT w.*, asm.name AS assembly_name, wd.name AS ward_name, bo.name AS booth_name
       FROM workers w
       LEFT JOIN locations asm ON asm.id = w.assembly_id
       LEFT JOIN locations wd  ON wd.id  = w.ward_id
       LEFT JOIN locations bo  ON bo.id  = w.booth_id
      WHERE w.id = ?`, [id]
  );
  if (!w) return null;

  const one = async (sql, params = []) => { const [r] = await query(sql, params); return Number(r?.c) || 0; };
  const total = await one(`SELECT COUNT(*) AS c FROM members WHERE worker_id=? AND status='active'`, [id]);
  const today = await one(`SELECT COUNT(*) AS c FROM members WHERE worker_id=? AND status='active' AND DATE(registered_at)=CURDATE()`, [id]);
  const week = await one(`SELECT COUNT(*) AS c FROM members WHERE worker_id=? AND status='active' AND YEARWEEK(registered_at,3)=YEARWEEK(CURDATE(),3)`, [id]);
  const month = await one(`SELECT COUNT(*) AS c FROM members WHERE worker_id=? AND status='active' AND YEAR(registered_at)=YEAR(CURDATE()) AND MONTH(registered_at)=MONTH(CURDATE())`, [id]);

  // Global rank = 1 + workers with strictly more active members.
  const globalRank = 1 + await one(
    `SELECT COUNT(*) AS c FROM (
        SELECT w2.id, COUNT(m.id) AS mc FROM workers w2
        LEFT JOIN members m ON m.worker_id=w2.id AND m.status='active'
        GROUP BY w2.id HAVING mc > ?
     ) x`, [total]
  );
  const posWithin = async (col) => {
    if (!w[col]) return null;
    return 1 + await one(
      `SELECT COUNT(*) AS c FROM (
          SELECT w2.id, COUNT(m.id) AS mc FROM workers w2
          LEFT JOIN members m ON m.worker_id=w2.id AND m.status='active'
          WHERE w2.${col} = ? GROUP BY w2.id HAVING mc > ?
       ) x`, [w[col], total]
    );
  };
  const assemblyPos = await posWithin("assembly_id");
  const wardPos = await posWithin("ward_id");

  // Growth series for this worker + recent members.
  const growth = await query(
    `SELECT DATE(registered_at) AS bucket, COUNT(*) AS cnt
       FROM members WHERE worker_id=? AND status='active'
      GROUP BY bucket ORDER BY bucket ASC`, [id]
  );
  let running = 0;
  const growthSeries = growth.map((r) => { running += Number(r.cnt) || 0; return { bucket: String(r.bucket), members: Number(r.cnt) || 0, cumulative: running }; });

  const members = await query(
    `SELECT m.id, m.name, m.membership_id, m.mobile, m.photo_url, m.registered_at,
            m.certificate_status, m.whatsapp_status, m.sms_status,
            asm.name AS assembly_name, wd.name AS ward_name
       FROM members m
       LEFT JOIN locations asm ON asm.id = m.assembly_id
       LEFT JOIN locations wd  ON wd.id  = m.ward_id
      WHERE m.worker_id=? AND m.status='active'
      ORDER BY m.registered_at DESC, m.id DESC LIMIT 200`, [id]
  );

  return {
    worker: {
      id: w.id, name: w.name, worker_code: w.worker_code, mobile: w.mobile, photo_url: w.photo_url,
      position: w.position, worker_status: w.status,
      assembly_name: w.assembly_name, ward_name: w.ward_name, booth_name: w.booth_name,
    },
    performance: {
      total, today, week, month,
      rank: globalRank, assemblyPosition: assemblyPos, wardPosition: wardPos,
    },
    growth: growthSeries,
    members,
  };
}

// Resolve preset/custom period into {from,to} for the routes.
export { resolvePeriod };
