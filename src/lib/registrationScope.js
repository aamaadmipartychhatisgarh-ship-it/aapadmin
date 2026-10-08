import { query } from "@/lib/db";
import { isCaller } from "@/lib/permissions";

// Zone-wise access control for Worker/Voter Registration records.
//
// Only a CALLER is scoped — central admins, supervisors and any other non-caller
// user keep their existing (unrestricted) access (spec §9). A caller sees only the
// registration records in the territory assigned to their user account, resolved
// to a set of assembly ids (reg_people carries assembly_id; reg_workers are scoped
// by the assemblies of the people they collected). A caller with NO territory
// assigned gets NOTHING, never unrestricted access (spec §8).
//
// Territory is taken from the caller's existing scope fields (most specific first):
// scope_assembly_id → that assembly; else scope_zone_id → every assembly under the
// zone; else home_district_id → every assembly under the district. The assembly →
// district → lok_sabha → zone chain is the standard `locations` hierarchy.

// Resolve the caller's allowed-assembly set to a SQL fragment that yields assembly
// ids. Returns one of:
//   { unrestricted: true } — not a caller (admin/supervisor/manager): no filter
//   { denied: true }       — a caller with no assigned territory: match nothing
//   { sql, params }        — a subquery/value producing the allowed assembly ids
function callerAssemblyScope(session) {
  if (!session?.user) return { denied: true };
  if (!isCaller(session)) return { unrestricted: true };
  const u = session.user;
  const asm = Number(u.scope_assembly_id) || null;
  const zone = Number(u.scope_zone_id) || null;
  const dist = Number(u.home_district_id) || null;
  if (asm) return { sql: "SELECT ? AS id", params: [asm] };
  if (zone) {
    return {
      sql: `SELECT a.id FROM locations a
              JOIN locations d ON d.id = a.parent_id AND d.type = 'district'
              JOIN locations ls ON ls.id = d.parent_id AND ls.type = 'lok_sabha'
             WHERE a.type = 'assembly' AND ls.parent_id = ?`,
      params: [zone],
    };
  }
  if (dist) return { sql: "SELECT id FROM locations WHERE type = 'assembly' AND parent_id = ?", params: [dist] };
  return { denied: true };
}

// A BARE WHERE condition (no leading AND) restricting an aliased reg_people row to
// the caller's territory. "" for unrestricted; "1 = 0" when denied.
export function peopleScopeCond(session, alias = "p") {
  const s = callerAssemblyScope(session);
  if (s.unrestricted) return { cond: "", params: [] };
  if (s.denied) return { cond: "1 = 0", params: [] };
  return { cond: `${alias}.assembly_id IN (${s.sql})`, params: s.params };
}

// A BARE WHERE condition scoping an aliased reg_workers row. A worker belongs to a
// caller's view when the caller CREATED the link OR the worker has collected at
// least one active person in the caller's territory (so a freshly-generated link
// is still visible to its creator before anyone registers through it). "" for
// unrestricted; own-links-only when the caller has no territory (never other zones).
export function workerScopeCond(session, alias = "w") {
  const s = callerAssemblyScope(session);
  if (s.unrestricted) return { cond: "", params: [] };
  const uid = Number(session?.user?.id) || 0;
  if (s.denied) return { cond: `${alias}.created_by = ?`, params: [uid] };
  return {
    cond: `(${alias}.created_by = ? OR EXISTS (SELECT 1 FROM reg_people rp WHERE rp.worker_id = ${alias}.id AND rp.status = 'active' AND rp.assembly_id IN (${s.sql})))`,
    params: [uid, ...s.params],
  };
}

// Single-record guard: may this caller view/edit the reg_people row in this
// assembly? Unrestricted → always; denied or an unassigned (NULL) assembly → no.
export async function assemblyInCallerScope(session, assemblyId) {
  const s = callerAssemblyScope(session);
  if (s.unrestricted) return true;
  if (s.denied) return false;
  if (assemblyId == null) return false;
  const rows = await query(`SELECT 1 FROM (${s.sql}) AS t WHERE t.id = ? LIMIT 1`, [...s.params, assemblyId]);
  return rows.length > 0;
}

// Single-record guard for a reg_workers row: unrestricted → always; the creator may
// always edit their own link; otherwise the worker must have collected an active
// person in the caller's territory.
export async function workerInCallerScope(session, workerId) {
  const s = callerAssemblyScope(session);
  if (s.unrestricted) return true;
  const uid = Number(session?.user?.id) || 0;
  const own = await query("SELECT 1 FROM reg_workers WHERE id = ? AND created_by = ? LIMIT 1", [workerId, uid]);
  if (own.length) return true;
  if (s.denied) return false;
  const rows = await query(
    `SELECT 1 FROM reg_people rp WHERE rp.worker_id = ? AND rp.status = 'active' AND rp.assembly_id IN (${s.sql}) LIMIT 1`,
    [workerId, ...s.params]
  );
  return rows.length > 0;
}
