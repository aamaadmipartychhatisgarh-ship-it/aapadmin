import { scopeFilterSync, ROLES } from "@/lib/permissions";

// Dedicated scoping for the Supervisor Contacts Distribution module ONLY.
// scopeFilterSync (permissions.js) intentionally treats `supervisor` as
// "sees everything" — every existing Supervisor page (Caller Performance,
// Area Reports, etc.) relies on that today. Rather than change shared
// behavior those pages depend on, this module gets its own strict scope,
// built from the scope_zone_id / home_district_id / scope_assembly_id
// columns already on `users` (populated onto session.user at login — see
// lib/auth.js's session callback).
//
// Precedence when a supervisor has more than one scope column set: the most
// specific wins (assembly > district > zone).

// For tables with zone_id/district_id/assembly_id columns (contacts,
// workers, calls, tasks...) — reuses scopeFilterSync's own, already-tested
// WHERE-building by impersonating the equivalent admin tier, instead of
// duplicating that SQL here.
export function supervisorScopeFilter(user, alias = "", opts = {}) {
  if (user?.scope_assembly_id) {
    return scopeFilterSync({ ...user, role: ROLES.ASSEMBLY_ADMIN }, alias, opts);
  }
  if (user?.home_district_id) {
    return scopeFilterSync({ ...user, role: ROLES.DISTRICT_ADMIN }, alias, opts);
  }
  if (user?.scope_zone_id) {
    return scopeFilterSync({ ...user, role: ROLES.ZONE_ADMIN }, alias, opts);
  }
  // No scope configured on this Supervisor account → show nothing, not
  // everything (strict-by-default, matches scopeFilterSync's own behavior
  // for an unscoped zone/district/assembly admin).
  return { where: "AND 1 = 0", params: [] };
}

// For the `users` table itself, whose geo columns are named differently
// (home_district_id / scope_zone_id / scope_assembly_id, not district_id/
// zone_id/assembly_id) — used to scope "which callers belong to this
// supervisor's territory." A caller's real-world geography lives in
// home_district_id in practice (scope_* columns are admin-tier fields), so
// this resolves the supervisor's anchor down to the district level and
// matches on that, same hierarchy-descent approach scopeFilterSync uses.
export function supervisorCallerScopeFilter(user, alias = "") {
  const tag = alias ? `${alias}.` : "";
  if (user?.scope_assembly_id) {
    return {
      where: `AND ${tag}home_district_id = (SELECT parent_id FROM locations WHERE id = ?)`,
      params: [user.scope_assembly_id],
    };
  }
  if (user?.home_district_id) {
    return { where: `AND ${tag}home_district_id = ?`, params: [user.home_district_id] };
  }
  if (user?.scope_zone_id) {
    return {
      where: `AND ${tag}home_district_id IN (
        SELECT d.id FROM locations d
        JOIN locations ls ON ls.id = d.parent_id AND ls.type = 'lok_sabha'
        WHERE ls.parent_id = ?
      )`,
      params: [user.scope_zone_id],
    };
  }
  return { where: "AND 1 = 0", params: [] };
}

// True if this supervisor account has ANY scope configured. Surfaced in the
// UI so an unconfigured supervisor gets a clear "ask your admin to set your
// territory" message instead of a silently-empty page.
export function supervisorHasScope(user) {
  return !!(user?.scope_assembly_id || user?.home_district_id || user?.scope_zone_id);
}

// Resolve the supervisor's territory into human-readable names for the page
// banner + to pre-lock the filter dropdowns at/above the anchor level.
// Returns null if no scope is configured.
export async function supervisorTerritory(user, query) {
  if (!supervisorHasScope(user)) return null;

  if (user.scope_assembly_id) {
    const rows = await query(
      `SELECT a.id AS assembly_id, a.name AS assembly_name,
              d.id AS district_id, d.name AS district_name,
              ls.id AS lok_sabha_id, ls.name AS lok_sabha_name,
              z.id AS zone_id, z.name AS zone_name
         FROM locations a
         LEFT JOIN locations d ON d.id = a.parent_id
         LEFT JOIN locations ls ON ls.id = d.parent_id
         LEFT JOIN locations z ON z.id = ls.parent_id
        WHERE a.id = ?`,
      [user.scope_assembly_id]
    );
    const r = rows[0];
    if (!r) return null;
    return {
      level: "assembly",
      zone: r.zone_id ? { id: r.zone_id, name: r.zone_name } : null,
      lok_sabha: r.lok_sabha_id ? { id: r.lok_sabha_id, name: r.lok_sabha_name } : null,
      district: r.district_id ? { id: r.district_id, name: r.district_name } : null,
      assembly: { id: r.assembly_id, name: r.assembly_name },
    };
  }

  if (user.home_district_id) {
    const rows = await query(
      `SELECT d.id AS district_id, d.name AS district_name,
              ls.id AS lok_sabha_id, ls.name AS lok_sabha_name,
              z.id AS zone_id, z.name AS zone_name
         FROM locations d
         LEFT JOIN locations ls ON ls.id = d.parent_id
         LEFT JOIN locations z ON z.id = ls.parent_id
        WHERE d.id = ?`,
      [user.home_district_id]
    );
    const r = rows[0];
    if (!r) return null;
    return {
      level: "district",
      zone: r.zone_id ? { id: r.zone_id, name: r.zone_name } : null,
      lok_sabha: r.lok_sabha_id ? { id: r.lok_sabha_id, name: r.lok_sabha_name } : null,
      district: { id: r.district_id, name: r.district_name },
      assembly: null,
    };
  }

  if (user.scope_zone_id) {
    const rows = await query("SELECT id, name FROM locations WHERE id = ?", [user.scope_zone_id]);
    const r = rows[0];
    if (!r) return null;
    return { level: "zone", zone: { id: r.id, name: r.name }, lok_sabha: null, district: null, assembly: null };
  }

  return null;
}
