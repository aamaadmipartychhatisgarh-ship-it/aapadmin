import { query } from "@/lib/db";
import { ensureMembershipSchema, resolvePeriod, columnsOf } from "@/lib/membershipSchema";

// Server-side aggregation for the Worker & Membership dashboard. Every statistic
// is computed in SQL (COUNT / GROUP BY / window RANK) so the client never pulls
// raw rows to add them up (§33, §38). Only status='active' members count — the
// one consistent "successful member" definition (§30).
//
// SCHEMA-ADAPTIVE: the `members` table may be this module's own or a pre-existing
// one from the worker app with a different shape. Before building any query we
// ask columnsOf() what columns really exist and reference ONLY those — a missing
// per-member assembly_id/ward_id falls back to the adding worker's geography, and
// a missing workers.worker_code falls back to a computed User ID. So a valid
// request never 500s on an "unknown column"; at worst an unsupported filter is
// skipped (and logged) rather than crashing (§1–§10).
//
// Geography note: this product's hierarchy is
//   zone → lok_sabha → district → assembly → ward → booth
// and the UI label "Block" maps to the `ward` type (there is no separate block).

// worker_code may be absent (older schema / a failed ALTER); fall back to a
// computed "first 4 letters + @ + id" so a User ID always shows.
function workerCodeExpr(wcols, alias = "w") {
  const fallback = `CONCAT(UPPER(LEFT(COALESCE(${alias}.name,''),4)),'@',LPAD(${alias}.id,4,'0'))`;
  return wcols.has("worker_code") ? `COALESCE(${alias}.worker_code, ${fallback})` : fallback;
}
function workerStatusExpr(wcols, alias = "w") {
  return wcols.has("status") ? `${alias}.status` : "'active'";
}

// Member-side WHERE (status + period + geo + worker), built only from columns
// that exist. Returns needWorkerJoin when a filter resolves to the worker's geo.
function memberFilters({ from, to, assemblyId, wardId, boothId, workerId }, mcols) {
  const cond = []; const params = []; let needWorkerJoin = false;
  if (mcols.has("status")) cond.push("m.status='active'");
  if (mcols.has("registered_at")) {
    if (from) { cond.push("m.registered_at >= ?"); params.push(`${from} 00:00:00`); }
    if (to) { cond.push("m.registered_at < DATE_ADD(?, INTERVAL 1 DAY)"); params.push(`${to} 00:00:00`); }
  }
  const geo = (field, val) => {
    if (!val) return;
    if (mcols.has(field)) cond.push(`m.${field} = ?`);
    else { cond.push(`w.${field} = ?`); needWorkerJoin = true; }
    params.push(val);
  };
  geo("assembly_id", assemblyId); geo("ward_id", wardId); geo("booth_id", boothId);
  if (workerId && mcols.has("worker_id")) { cond.push("m.worker_id = ?"); params.push(workerId); }
  return { cond, params, needWorkerJoin };
}
function workerJoinSql(needJoin, mcols) {
  if (!needJoin) return "";
  return mcols.has("worker_id") ? "LEFT JOIN workers w ON w.id = m.worker_id" : "LEFT JOIN workers w ON 1=0";
}
const whereFrom = (cond) => (cond.length ? "WHERE " + cond.join(" AND ") : "");

// ---------------------------------------------------------------- SUMMARY
export async function getSummary({ from, to, assemblyId, wardId, boothId } = {}) {
  await ensureMembershipSchema();
  const mcols = await columnsOf("members");

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

  // Members in period+geo, and lifetime (geo only).
  const period = memberFilters({ from, to, assemblyId, wardId, boothId }, mcols);
  const [{ period_members }] = await query(
    `SELECT COUNT(*) AS period_members FROM members m ${workerJoinSql(period.needWorkerJoin, mcols)} ${whereFrom(period.cond)}`,
    period.params
  );
  const life = memberFilters({ assemblyId, wardId, boothId }, mcols);
  const [{ lifetime_members }] = await query(
    `SELECT COUNT(*) AS lifetime_members FROM members m ${workerJoinSql(life.needWorkerJoin, mcols)} ${whereFrom(life.cond)}`,
    life.params
  );

  // Distinct workers with ≥1 member in period+geo.
  let workersWith = 0;
  if (mcols.has("worker_id")) {
    const p2 = memberFilters({ from, to, assemblyId, wardId, boothId }, mcols);
    const [{ ww }] = await query(
      `SELECT COUNT(DISTINCT m.worker_id) AS ww FROM members m ${workerJoinSql(p2.needWorkerJoin, mcols)} ${whereFrom(p2.cond)}`,
      p2.params
    );
    workersWith = Number(ww) || 0;
  }
  const totalWorkers = Number(total_workers) || 0;
  const activeWorkers = Number(active_workers) || 0;
  const periodMembers = Number(period_members) || 0;
  return {
    totalWorkers, activeWorkers, periodMembers,
    lifetimeMembers: Number(lifetime_members) || 0,
    workersWithMembers: workersWith,
    workersWithZero: Math.max(0, totalWorkers - workersWith),
    avgMembersPerWorker: activeWorkers > 0 ? Math.round((periodMembers / activeWorkers) * 100) / 100 : 0,
  };
}

// ------------------------------------------------------- WORKER RANK CORE
// Per-worker aggregate + GLOBAL rank (computed before worker/search filters).
// Tie-break: equal counts → earlier achiever (earlier last-member time) ranks
// higher, then id — deterministic and stable across refreshes (§13, §14).
async function rankedWorkersSubquery(from, to) {
  const mcols = await columnsOf("members");
  const wcols = await columnsOf("workers");
  const params = [];
  const memberConds = [];
  if (mcols.has("worker_id")) {
    if (mcols.has("status")) memberConds.push("m.status='active'");
    if (mcols.has("registered_at")) {
      if (from) { memberConds.push("m.registered_at >= ?"); params.push(`${from} 00:00:00`); }
      if (to) { memberConds.push("m.registered_at < DATE_ADD(?, INTERVAL 1 DAY)"); params.push(`${to} 00:00:00`); }
    }
  }
  const memberJoin = mcols.has("worker_id")
    ? `LEFT JOIN members m ON m.worker_id = w.id${memberConds.length ? " AND " + memberConds.join(" AND ") : ""}`
    : "LEFT JOIN members m ON 1=0";
  const lastExpr = mcols.has("registered_at") ? "MAX(m.registered_at)" : "NULL";
  const sql = `
    SELECT r.*,
      RANK() OVER (ORDER BY r.member_count DESC, r.last_member_at IS NULL ASC, r.last_member_at ASC, r.id ASC) AS rnk
    FROM (
      SELECT w.id, w.name, ${workerCodeExpr(wcols)} AS worker_code, w.mobile, w.photo_url, w.position,
             ${workerStatusExpr(wcols)} AS worker_status,
             w.assembly_id, w.ward_id, w.booth_id,
             asm.name AS assembly_name, wd.name AS ward_name, bo.name AS booth_name,
             COUNT(m.id) AS member_count, ${lastExpr} AS last_member_at
        FROM workers w
        LEFT JOIN locations asm ON asm.id = w.assembly_id
        LEFT JOIN locations wd  ON wd.id  = w.ward_id
        LEFT JOIN locations bo  ON bo.id  = w.booth_id
        ${memberJoin}
        GROUP BY w.id
    ) r`;
  return { sql, params };
}

const WORKER_SORTS = {
  members: "member_count", rank: "rnk", name: "name",
  assembly: "assembly_name", ward: "ward_name", last_activity: "last_member_at",
};

// ---------------------------------------------------------- WORKER TABLE
export async function getWorkersPage({
  from, to, assemblyId, wardId, boothId, search,
  workerStatus, membership, page = 1, pageSize = 20, sort = "members", dir = "desc",
} = {}) {
  await ensureMembershipSchema();
  const base = await rankedWorkersSubquery(from, to);

  const where = []; const filterParams = [];
  if (assemblyId) { where.push("t.assembly_id = ?"); filterParams.push(assemblyId); }
  if (wardId) { where.push("t.ward_id = ?"); filterParams.push(wardId); }
  if (boothId) { where.push("t.booth_id = ?"); filterParams.push(boothId); }
  if (workerStatus) { where.push("t.worker_status = ?"); filterParams.push(workerStatus); }
  if (membership === "with") where.push("t.member_count > 0");
  if (membership === "zero") where.push("t.member_count = 0");
  if (search && search.trim()) {
    where.push("(t.name LIKE ? OR t.worker_code LIKE ? OR t.mobile LIKE ?)");
    const like = `%${search.trim()}%`; filterParams.push(like, like, like);
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const sortCol = WORKER_SORTS[sort] || "member_count";
  const dirSql = dir === "asc" ? "ASC" : "DESC";
  const limit = Math.min(100, Math.max(1, pageSize));
  const offset = (Math.max(1, page) - 1) * limit;

  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM (${base.sql}) t ${whereSql}`, [...base.params, ...filterParams]
  );
  const rows = await query(
    `SELECT * FROM (${base.sql}) t ${whereSql} ORDER BY ${sortCol} ${dirSql}, t.rnk ASC LIMIT ${limit} OFFSET ${offset}`,
    [...base.params, ...filterParams]
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
    totalPages: Math.max(1, Math.ceil((Number(total) || 0) / limit)),
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
  const mcols = await columnsOf("members");
  if (!mcols.has("registered_at")) return []; // no timestamp → no growth series
  const f = memberFilters({ from, to, assemblyId, wardId, boothId }, mcols);
  const expr = bucket === "month" ? "DATE_FORMAT(m.registered_at, '%Y-%m')"
    : bucket === "week" ? "DATE_FORMAT(m.registered_at, '%x-W%v')"
    : "DATE(m.registered_at)";
  const rows = await query(
    `SELECT ${expr} AS bucket, COUNT(*) AS cnt
       FROM members m ${workerJoinSql(f.needWorkerJoin, mcols)} ${whereFrom(f.cond)}
      GROUP BY bucket ORDER BY bucket ASC`,
    f.params
  );
  let running = 0;
  return rows.map((r) => { running += Number(r.cnt) || 0; return { bucket: String(r.bucket), members: Number(r.cnt) || 0, cumulative: running }; });
}

// ------------------------------------------------ ASSEMBLY / WARD BREAKDOWN
// Member join condition string (status + date), guarded by the members schema.
async function memberJoinForBreakdown(from, to, mcols) {
  const conds = []; const params = [];
  if (mcols.has("worker_id")) {
    if (mcols.has("status")) conds.push("m.status='active'");
    if (mcols.has("registered_at")) {
      if (from) { conds.push("m.registered_at >= ?"); params.push(`${from} 00:00:00`); }
      if (to) { conds.push("m.registered_at < DATE_ADD(?, INTERVAL 1 DAY)"); params.push(`${to} 00:00:00`); }
    }
    return { join: `LEFT JOIN members m ON m.worker_id = w.id${conds.length ? " AND " + conds.join(" AND ") : ""}`, params };
  }
  return { join: "LEFT JOIN members m ON 1=0", params };
}

export async function getAssemblyBreakdown({ from, to } = {}) {
  await ensureMembershipSchema();
  const mcols = await columnsOf("members");
  const mj = await memberJoinForBreakdown(from, to, mcols);
  const rows = await query(
    `SELECT w.assembly_id AS id, asm.name AS name,
            COUNT(DISTINCT w.id) AS total_workers,
            COUNT(DISTINCT CASE WHEN w.status='active' THEN w.id END) AS active_workers,
            COUNT(DISTINCT CASE WHEN m.id IS NOT NULL THEN w.id END) AS workers_with,
            COUNT(m.id) AS total_members
       FROM workers w
       LEFT JOIN locations asm ON asm.id = w.assembly_id
       ${mj.join}
      GROUP BY w.assembly_id
      ORDER BY total_members DESC, total_workers DESC`,
    mj.params
  );
  return rows.map((r, i) => decorateGroup(r, i));
}

export async function getWardBreakdown({ from, to, assemblyId } = {}) {
  await ensureMembershipSchema();
  const mcols = await columnsOf("members");
  const mj = await memberJoinForBreakdown(from, to, mcols);
  const wWhere = assemblyId ? "WHERE w.assembly_id = ?" : "";
  const rows = await query(
    `SELECT w.ward_id AS id, wd.name AS name, asm.name AS assembly_name,
            COUNT(DISTINCT w.id) AS total_workers,
            COUNT(DISTINCT CASE WHEN w.status='active' THEN w.id END) AS active_workers,
            COUNT(DISTINCT CASE WHEN m.id IS NOT NULL THEN w.id END) AS workers_with,
            COUNT(m.id) AS total_members
       FROM workers w
       LEFT JOIN locations wd  ON wd.id  = w.ward_id
       LEFT JOIN locations asm ON asm.id = w.assembly_id
       ${mj.join}
       ${wWhere}
      GROUP BY w.ward_id
      ORDER BY total_members DESC, total_workers DESC`,
    assemblyId ? [...mj.params, assemblyId] : mj.params
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
    total_workers: totalWorkers, active_workers: activeWorkers, total_members: totalMembers,
    workers_with_members: workersWith,
    workers_with_zero: Math.max(0, totalWorkers - workersWith),
    avg_members: activeWorkers > 0 ? Math.round((totalMembers / activeWorkers) * 100) / 100 : 0,
    rank: i + 1,
  };
}

// ----------------------------------------------------------- MEMBER LIST
export async function getMembersPage({
  from, to, assemblyId, wardId, boothId, search, workerId,
  certificate, whatsapp, sms, page = 1, pageSize = 20,
} = {}) {
  await ensureMembershipSchema();
  const mcols = await columnsOf("members");
  const wcols = await columnsOf("workers");

  const asmSrc = mcols.has("assembly_id") ? "m.assembly_id" : "w.assembly_id";
  const wardSrc = mcols.has("ward_id") ? "m.ward_id" : "w.ward_id";
  const boothSrc = mcols.has("booth_id") ? "m.booth_id" : "w.booth_id";
  const wJoin = mcols.has("worker_id") ? "LEFT JOIN workers w ON w.id = m.worker_id" : "LEFT JOIN workers w ON 1=0";

  const where = []; const params = [];
  if (mcols.has("status")) where.push("m.status='active'");
  if (mcols.has("registered_at")) {
    if (from) { where.push("m.registered_at >= ?"); params.push(`${from} 00:00:00`); }
    if (to) { where.push("m.registered_at < DATE_ADD(?, INTERVAL 1 DAY)"); params.push(`${to} 00:00:00`); }
  }
  if (assemblyId) { where.push(`${asmSrc} = ?`); params.push(assemblyId); }
  if (wardId) { where.push(`${wardSrc} = ?`); params.push(wardId); }
  if (boothId) { where.push(`${boothSrc} = ?`); params.push(boothId); }
  if (workerId && mcols.has("worker_id")) { where.push("m.worker_id = ?"); params.push(workerId); }
  if (certificate && mcols.has("certificate_status")) { where.push("m.certificate_status = ?"); params.push(certificate); }
  if (whatsapp && mcols.has("whatsapp_status")) { where.push("m.whatsapp_status = ?"); params.push(whatsapp); }
  if (sms && mcols.has("sms_status")) { where.push("m.sms_status = ?"); params.push(sms); }
  if (search && search.trim()) {
    const parts = [];
    if (mcols.has("name")) parts.push("m.name LIKE ?");
    if (mcols.has("mobile")) parts.push("m.mobile LIKE ?");
    if (mcols.has("membership_id")) parts.push("m.membership_id LIKE ?");
    parts.push("w.name LIKE ?");
    if (wcols.has("worker_code")) parts.push("w.worker_code LIKE ?");
    where.push(`(${parts.join(" OR ")})`);
    const like = `%${search.trim()}%`; parts.forEach(() => params.push(like));
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const dateSort = mcols.has("registered_at") ? "m.registered_at DESC, m.id DESC" : "m.id DESC";
  const limit = Math.min(100, Math.max(1, pageSize));
  const offset = (Math.max(1, page) - 1) * limit;

  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM members m ${wJoin} ${whereSql}`, params
  );
  const rows = await query(
    `SELECT m.*, w.name AS worker_name, ${workerCodeExpr(wcols)} AS worker_code,
            asm.name AS assembly_name, wd.name AS ward_name, bo.name AS booth_name
       FROM members m
       ${wJoin}
       LEFT JOIN locations asm ON asm.id = ${asmSrc}
       LEFT JOIN locations wd  ON wd.id  = ${wardSrc}
       LEFT JOIN locations bo  ON bo.id  = ${boothSrc}
       ${whereSql}
      ORDER BY ${dateSort}
      LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  return {
    members: rows.map(shapeMember),
    total: Number(total) || 0,
    page: Math.max(1, page), pageSize: limit,
    pages: Math.max(1, Math.ceil((Number(total) || 0) / limit)),
    totalPages: Math.max(1, Math.ceil((Number(total) || 0) / limit)),
  };
}

// Normalize a member row so the UI always gets the fields it needs, null-safe.
function shapeMember(m) {
  return {
    id: m.id,
    membership_id: m.membership_id ?? null,
    name: m.name ?? null,
    mobile: m.mobile ?? null,
    photo_url: m.photo_url ?? null,
    address: m.address ?? null,
    assembly_id: m.assembly_id ?? null,
    ward_id: m.ward_id ?? null,
    booth_id: m.booth_id ?? null,
    worker_id: m.worker_id ?? null,
    registered_at: m.registered_at ?? m.created_at ?? null,
    certificate_status: m.certificate_status ?? null,
    whatsapp_status: m.whatsapp_status ?? null,
    sms_status: m.sms_status ?? null,
    certificate_generated_at: m.certificate_generated_at ?? null,
    worker_name: m.worker_name ?? null,
    worker_code: m.worker_code ?? null,
    assembly_name: m.assembly_name ?? null,
    ward_name: m.ward_name ?? null,
    booth_name: m.booth_name ?? null,
  };
}

export async function getMemberDetail(id) {
  await ensureMembershipSchema();
  const mcols = await columnsOf("members");
  const wcols = await columnsOf("workers");
  const asmSrc = mcols.has("assembly_id") ? "m.assembly_id" : "w.assembly_id";
  const wardSrc = mcols.has("ward_id") ? "m.ward_id" : "w.ward_id";
  const boothSrc = mcols.has("booth_id") ? "m.booth_id" : "w.booth_id";
  const wJoin = mcols.has("worker_id") ? "LEFT JOIN workers w ON w.id = m.worker_id" : "LEFT JOIN workers w ON 1=0";
  const [row] = await query(
    `SELECT m.*, w.name AS worker_name, ${workerCodeExpr(wcols)} AS worker_code, w.mobile AS worker_mobile,
            asm.name AS assembly_name, wd.name AS ward_name, bo.name AS booth_name
       FROM members m
       ${wJoin}
       LEFT JOIN locations asm ON asm.id = ${asmSrc}
       LEFT JOIN locations wd  ON wd.id  = ${wardSrc}
       LEFT JOIN locations bo  ON bo.id  = ${boothSrc}
      WHERE m.id = ?`, [id]
  );
  if (!row) return null;
  return { ...shapeMember(row), worker_mobile: row.worker_mobile ?? null };
}

// -------------------------------------------------- INDIVIDUAL WORKER VIEW
export async function getWorkerDetail(id) {
  await ensureMembershipSchema();
  const mcols = await columnsOf("members");
  const wcols = await columnsOf("workers");
  const [w] = await query(
    `SELECT w.*, ${workerCodeExpr(wcols)} AS worker_code_out,
            asm.name AS assembly_name, wd.name AS ward_name, bo.name AS booth_name
       FROM workers w
       LEFT JOIN locations asm ON asm.id = w.assembly_id
       LEFT JOIN locations wd  ON wd.id  = w.ward_id
       LEFT JOIN locations bo  ON bo.id  = w.booth_id
      WHERE w.id = ?`, [id]
  );
  if (!w) return null;

  const linked = mcols.has("worker_id");
  const active = mcols.has("status") ? " AND status='active'" : "";
  const hasDate = mcols.has("registered_at");
  const one = async (sql, params = []) => { try { const [r] = await query(sql, params); return Number(r?.c) || 0; } catch { return 0; } };

  const total = linked ? await one(`SELECT COUNT(*) AS c FROM members WHERE worker_id=?${active}`, [id]) : 0;
  const today = linked && hasDate ? await one(`SELECT COUNT(*) AS c FROM members WHERE worker_id=?${active} AND DATE(registered_at)=CURDATE()`, [id]) : 0;
  const week = linked && hasDate ? await one(`SELECT COUNT(*) AS c FROM members WHERE worker_id=?${active} AND YEARWEEK(registered_at,3)=YEARWEEK(CURDATE(),3)`, [id]) : 0;
  const month = linked && hasDate ? await one(`SELECT COUNT(*) AS c FROM members WHERE worker_id=?${active} AND YEAR(registered_at)=YEAR(CURDATE()) AND MONTH(registered_at)=MONTH(CURDATE())`, [id]) : 0;

  const globalRank = linked ? 1 + await one(
    `SELECT COUNT(*) AS c FROM (
       SELECT w2.id, COUNT(m.id) AS mc FROM workers w2
       LEFT JOIN members m ON m.worker_id=w2.id${active} GROUP BY w2.id HAVING mc > ?
     ) x`, [total]) : 1;
  const posWithin = async (col) => {
    if (!linked || !w[col]) return null;
    return 1 + await one(
      `SELECT COUNT(*) AS c FROM (
         SELECT w2.id, COUNT(m.id) AS mc FROM workers w2
         LEFT JOIN members m ON m.worker_id=w2.id${active}
         WHERE w2.${col} = ? GROUP BY w2.id HAVING mc > ?
       ) x`, [w[col], total]);
  };
  const assemblyPos = await posWithin("assembly_id");
  const wardPos = await posWithin("ward_id");

  let growthSeries = [];
  if (linked && hasDate) {
    const growth = await query(
      `SELECT DATE(registered_at) AS bucket, COUNT(*) AS cnt FROM members WHERE worker_id=?${active} GROUP BY bucket ORDER BY bucket ASC`, [id]
    ).catch(() => []);
    let running = 0;
    growthSeries = growth.map((r) => { running += Number(r.cnt) || 0; return { bucket: String(r.bucket), members: Number(r.cnt) || 0, cumulative: running }; });
  }

  let members = [];
  if (linked) {
    const asmSrc = mcols.has("assembly_id") ? "m.assembly_id" : "NULL";
    const wardSrc = mcols.has("ward_id") ? "m.ward_id" : "NULL";
    const dateSort = hasDate ? "m.registered_at DESC, m.id DESC" : "m.id DESC";
    members = await query(
      `SELECT m.*, asm.name AS assembly_name, wd.name AS ward_name
         FROM members m
         LEFT JOIN locations asm ON asm.id = ${asmSrc}
         LEFT JOIN locations wd  ON wd.id  = ${wardSrc}
        WHERE m.worker_id=?${active}
        ORDER BY ${dateSort} LIMIT 200`, [id]
    ).catch(() => []);
    members = members.map(shapeMember);
  }

  return {
    worker: {
      id: w.id, name: w.name, worker_code: w.worker_code_out, mobile: w.mobile, photo_url: w.photo_url,
      position: w.position, worker_status: w.status,
      assembly_name: w.assembly_name, ward_name: w.ward_name, booth_name: w.booth_name,
    },
    performance: { total, today, week, month, rank: globalRank, assemblyPosition: assemblyPos, wardPosition: wardPos },
    growth: growthSeries,
    members,
  };
}

export { resolvePeriod };
