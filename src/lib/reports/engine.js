// Universal Reports Engine — query builder.
//
// Turns (module descriptor + client filters) into a safe, parameterized SQL
// query and runs it. Two modes:
//   • detail  — paginated rows of selected columns (Table/List/Grid views)
//   • summary — GROUP BY a dimension with COUNT(*) (Summary/Chart views)
//
// Safety model: every SQL *fragment* (table, alias, joins, column/filter/
// group-by expressions) originates in registry.js. Client input can only pick
// among the keys defined there; all values are bound parameters. LIMIT/OFFSET
// are clamped integers inlined directly (never client strings).

import { query } from "@/lib/db";
import { getModule, MODULES } from "./registry";
import { resolveRange } from "./timeRanges";
import { geoFilter } from "@/lib/geoFilter";
import { scopeFilterSync, roleOf, OVERSIGHT_ROLES } from "@/lib/permissions";

const MAX_PAGE_SIZE = 200;
const MAX_SUMMARY_ROWS = 500;
const MAX_EXPORT_ROWS = 20000;

// Who can run a module's report: descriptor.access(role) if defined, else any
// oversight role (admins + supervisor).
function canAccess(module, role) {
  if (typeof module.access === "function") return !!module.access(role);
  return OVERSIGHT_ROLES.includes(role);
}

export function accessibleModules(session) {
  const role = roleOf(session);
  return MODULES.filter((m) => canAccess(m, role)).map((m) => ({
    key: m.key, label: m.label, icon: m.icon, geo: !!m.geo,
  }));
}

// Full filter/column/group metadata for one module (for the Reports Center UI).
// Resolves any DB-backed option lists (optionsFrom).
export async function moduleMeta(module) {
  const filters = [];
  for (const f of module.filters || []) {
    const out = { key: f.key, label: f.label, type: f.type };
    if (f.options) out.options = f.options;
    if (f.optionsFrom === "call_statuses") {
      const rows = await query("SELECT id, name FROM call_statuses ORDER BY id");
      out.options = rows.map((r) => ({ value: String(r.id), label: r.name }));
    } else if (f.optionsFrom === "designations") {
      const rows = await query("SELECT id, name FROM designations ORDER BY name");
      out.options = rows.map((r) => ({ value: String(r.id), label: r.name }));
    } else if (f.optionsFrom === "teams") {
      const rows = await query("SELECT id, name FROM teams ORDER BY name");
      out.options = rows.map((r) => ({ value: String(r.id), label: r.name }));
    }
    filters.push(out);
  }
  return {
    key: module.key,
    label: module.label,
    geo: !!module.geo,
    columns: module.columns.map((c) => ({ key: c.key, label: c.label, type: c.type })),
    defaultColumns: module.defaultColumns,
    filters,
    groupBy: module.groupBy.map((g) => ({ key: g.key, label: g.label })),
  };
}

function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

// Build the shared WHERE (role scope + time + filters + geo + search).
function buildWhere(module, session, body) {
  let where = "WHERE 1=1";
  const params = [];

  // 1. Role/geography scope (server-enforced; client cannot widen it).
  if (module.scopeCols && session?.user) {
    const s = scopeFilterSync(session.user, module.alias, { cols: module.scopeCols });
    if (s.where) { where += " " + s.where; params.push(...s.params); }
  }

  // 2. Time range on the module's date field (IST calendar days).
  const range = resolveRange(body.time, body.date_from, body.date_to);
  if (range) {
    where += ` AND DATE(CONVERT_TZ(${module.dateField},'+00:00','+05:30')) BETWEEN ? AND ?`;
    params.push(range.from, range.to);
  }

  // 3. Declared filters.
  const fvals = body.filters || {};
  for (const f of module.filters || []) {
    const raw = fvals[f.key];
    if (raw === undefined || raw === null || raw === "") continue;

    if (f.type === "bool") {
      where += ` AND ${f.column} = ?`;
      params.push(raw === "1" || raw === 1 || raw === true || raw === "true" ? 1 : 0);
    } else if (f.type === "enum" || f.type === "user") {
      const vals = (Array.isArray(raw) ? raw : String(raw).split(",")).map((v) => String(v).trim()).filter(Boolean);
      if (vals.length) {
        where += ` AND ${f.column} IN (${vals.map(() => "?").join(",")})`;
        params.push(...vals);
      }
    } else if (f.type === "search-eq") {
      where += ` AND ${f.column} = ?`;
      params.push(String(raw));
    } else if (f.type === "m2m") {
      // Many-to-many relationship (e.g. worker <-> team via team_members) —
      // existsSql carries a %IN% placeholder the engine fills with bound `?`s.
      const vals = (Array.isArray(raw) ? raw : String(raw).split(",")).map((v) => String(v).trim()).filter(Boolean);
      if (vals.length) {
        where += ` AND ${f.existsSql.replace("%IN%", vals.map(() => "?").join(","))}`;
        params.push(...vals);
      }
    }
  }

  // 4. Hierarchical geography filter.
  if (module.geo && body.geo) {
    const g = geoFilter(module.alias, body.geo);
    if (g.clauses.length) { where += " AND " + g.clauses.join(" AND "); params.push(...g.params); }
  }

  // 5. Universal keyword search.
  const term = (body.search || "").trim();
  if (term && module.searchCols?.length) {
    where += " AND (" + module.searchCols.map((c) => `${c} LIKE ?`).join(" OR ") + ")";
    for (let i = 0; i < module.searchCols.length; i++) params.push(`%${term}%`);
  }

  return { where, params };
}

// opts.exportAll — skip pagination and fetch up to MAX_EXPORT_ROWS in one
// shot (Export/Print use this so the file matches every filtered row, not
// just whatever page happens to be on screen — the old CSV button's bug).
export async function runReport({ moduleKey, session, body, opts = {} }) {
  const module = getModule(moduleKey);
  if (!module) return { error: "Unknown module", status: 404 };

  const role = roleOf(session);
  if (!canAccess(module, role)) return { error: "Forbidden", status: 403 };

  const from = `FROM ${module.table} ${module.alias} ${module.joins || ""}`;
  const { where, params } = buildWhere(module, session, body);

  // ---- Summary (GROUP BY) mode --------------------------------------------
  if (body.group_by) {
    const gb = module.groupBy.find((g) => g.key === body.group_by);
    if (!gb) return { error: "Invalid group_by", status: 400 };
    const rows = await query(
      `SELECT ${gb.sql} AS group_key, COUNT(*) AS count
         ${from} ${where}
        GROUP BY group_key
        ORDER BY count DESC
        LIMIT ${MAX_SUMMARY_ROWS}`,
      params
    );
    const totalRecords = rows.reduce((s, r) => s + Number(r.count || 0), 0);
    return {
      mode: "summary",
      module: module.label,
      group_by: gb.key,
      group_label: gb.label,
      rows: rows.map((r) => ({ group_key: r.group_key ?? "(none)", count: Number(r.count) })),
      groups: rows.length,
      totalRecords,
    };
  }

  // ---- Detail (paginated, or exportAll up to MAX_EXPORT_ROWS) mode --------
  const requested = Array.isArray(body.columns) ? body.columns : null;
  const cols = module.columns.filter((c) =>
    requested ? requested.includes(c.key) : module.defaultColumns.includes(c.key)
  );
  const useCols = cols.length ? cols : module.columns.filter((c) => module.defaultColumns.includes(c.key));
  const selectList = useCols.map((c) => `${c.sql} AS \`${c.key}\``).join(", ");

  // Sorting — validate against known columns; default to date field desc.
  let sortCol = module.dateField;
  const sortKeyDef = module.columns.find((c) => c.key === body.sort?.key);
  if (sortKeyDef) sortCol = sortKeyDef.sql;
  const dir = String(body.sort?.dir).toLowerCase() === "asc" ? "ASC" : "DESC";

  const [{ total }] = await query(`SELECT COUNT(*) AS total ${from} ${where}`, params);

  if (opts.exportAll) {
    const rows = await query(
      `SELECT ${selectList} ${from} ${where} ORDER BY ${sortCol} ${dir} LIMIT ${MAX_EXPORT_ROWS}`,
      params
    );
    return {
      mode: "detail",
      module: module.label,
      columns: useCols.map((c) => ({ key: c.key, label: c.label, type: c.type })),
      rows,
      total: Number(total),
      truncated: Number(total) > rows.length,
    };
  }

  const pageSize = clampInt(body.pageSize, 1, MAX_PAGE_SIZE, 50);
  const page = clampInt(body.page, 1, 1e9, 1);
  const offset = (page - 1) * pageSize;

  const rows = await query(
    `SELECT ${selectList} ${from} ${where} ORDER BY ${sortCol} ${dir} LIMIT ${pageSize} OFFSET ${offset}`,
    params
  );

  return {
    mode: "detail",
    module: module.label,
    columns: useCols.map((c) => ({ key: c.key, label: c.label, type: c.type })),
    rows,
    total: Number(total),
    page,
    pageSize,
  };
}
