import { query } from "@/lib/db";
import { normalizeRole, ROLES } from "@/lib/permissions";
import { contactsByDistrict } from "@/lib/workerCounts";
import { requiredWorkersFor } from "@/lib/chhattisgarhAssemblies";

// Role-based district scope, shared by every worker-stat view so they always
// apply IDENTICAL territory rules. Applied to a query that exposes `ld` (the
// district row) and `lz` (its zone, via the district → lok_sabha → zone joins):
//   zone-admin     → districts in that zone
//   district-admin → only their district
//   assembly-admin → the district that owns their assembly
//   everyone else (super/state admin, supervisor) → all districts
function districtScope(session) {
  const role = normalizeRole(session.user.role);
  const u = session.user;
  if (role === ROLES.ZONE_ADMIN && u.scope_zone_id) return { where: "AND lz.id = ?", params: [u.scope_zone_id] };
  if (role === ROLES.DISTRICT_ADMIN && u.home_district_id) return { where: "AND ld.id = ?", params: [u.home_district_id] };
  if (role === ROLES.ASSEMBLY_ADMIN && u.scope_assembly_id) return { where: "AND ld.id = (SELECT parent_id FROM locations WHERE id = ?)", params: [u.scope_assembly_id] };
  return { where: "", params: [] };
}

// THE single source of truth for district worker statistics — reused by
// Strength, Area Ranking, the Workers-by-District tree map and the Organization
// Map so all four ALWAYS show identical numbers for the same district.
//
// For every in-scope district in Master Data (locations type='district') —
// INCLUDING districts with zero workers — it returns:
//   { id, district, zone, lok_sabha, requiredWorkers, actualWorkers,
//     attemptCalls, strengthPercentage }
//
//  • actualWorkers  = live Contacts count keyed by district_id (each contact
//                     counted exactly once; wrong-number rows excluded; no
//                     duplicates, no hardcoding — tracks Contacts changes live).
//  • requiredWorkers = the fixed per-district target (resolved by NORMALIZED
//                     name + aliases, so capitalization / spacing / renamed
//                     districts still map — IDs drive the count, names only the
//                     target lookup).
//  • attemptCalls   = live COUNT of calls logged into the district.
//  • strengthPercentage = clamp(actualWorkers / requiredWorkers * 100, 0..100),
//                     kept to 2 decimals (e.g. 1342/6000 → 22.37, NOT rounded to
//                     22) so districts with genuinely different strength never
//                     collapse to the same integer and the ranking sort is
//                     precise; 0 when required is 0 (never NaN / Infinity).
//
// Districts are joined to Contacts by district_id (Master Data relationship),
// never by comparing raw district-name strings, so minor name differences can't
// split or duplicate a district. Pass opts.districtId to narrow to one district.
export async function districtWorkerStats(session, { districtId } = {}) {
  const scope = districtScope(session);
  const params = [...scope.params];
  let where = `WHERE ld.type = 'district' ${scope.where}`;
  if (districtId) { where += " AND ld.id = ?"; params.push(districtId); }

  const [districts, contactCounts, callRows] = await Promise.all([
    query(
      `SELECT ld.id, ld.name AS district, lz.name AS zone, lls.name AS lok_sabha
         FROM locations ld
         LEFT JOIN locations lls ON lls.id = ld.parent_id AND lls.type = 'lok_sabha'
         LEFT JOIN locations lz  ON lz.id  = lls.parent_id AND lz.type = 'zone'
         ${where}
         ORDER BY ld.name ASC`,
      params
    ),
    contactsByDistrict(),
    query("SELECT district_id, COUNT(*) AS n FROM calls WHERE district_id IS NOT NULL GROUP BY district_id"),
  ]);
  const attemptByDistrict = new Map(callRows.map((r) => [r.district_id, Number(r.n) || 0]));

  return districts.map((d) => {
    const actualWorkers = contactCounts.get(d.id) || 0;
    const requiredWorkers = requiredWorkersFor(d.district);
    const strengthPercentage = requiredWorkers > 0
      ? Math.min(100, Math.max(0, Math.round((actualWorkers / requiredWorkers) * 10000) / 100))
      : 0;
    return {
      id: d.id,
      district: d.district,
      zone: d.zone || null,
      lok_sabha: d.lok_sabha || null,
      requiredWorkers,
      actualWorkers,
      attemptCalls: attemptByDistrict.get(d.id) || 0,
      strengthPercentage,
    };
  });
}
