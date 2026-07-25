// Hierarchical geography filter for a table that carries zone_id / lok_sabha_id /
// district_id / assembly_id (contacts, workers, calls). Returns { clauses, params }
// to splice into a WHERE.
//
// Zone/Lok-Sabha matching rolls up through the location tree so a row that only
// has district_id or assembly_id set still matches its ancestor zone/Lok Sabha
// (many imported contacts have no zone_id/lok_sabha_id). District matches its own
// id or an assembly under it; assembly is an exact match.
export function geoFilter(alias, { zone_id, lok_sabha_id, district_id, assembly_id } = {}) {
  const a = alias ? `${alias}.` : "";
  const clauses = [];
  const params = [];

  if (zone_id) {
    clauses.push(`(
      ${a}zone_id = ?
      OR ${a}lok_sabha_id IN (SELECT id FROM locations WHERE type='lok_sabha' AND parent_id = ?)
      OR ${a}district_id IN (
        SELECT d.id FROM locations d
        JOIN locations ls ON ls.id = d.parent_id AND ls.type='lok_sabha'
        WHERE ls.parent_id = ?)
      OR ${a}assembly_id IN (
        SELECT a2.id FROM locations a2
        JOIN locations d ON d.id = a2.parent_id AND d.type='district'
        JOIN locations ls ON ls.id = d.parent_id AND ls.type='lok_sabha'
        WHERE ls.parent_id = ?)
    )`);
    params.push(zone_id, zone_id, zone_id, zone_id);
  }

  if (lok_sabha_id) {
    clauses.push(`(
      ${a}lok_sabha_id = ?
      OR ${a}district_id IN (SELECT id FROM locations WHERE type='district' AND parent_id = ?)
      OR ${a}assembly_id IN (
        SELECT a2.id FROM locations a2
        JOIN locations d ON d.id = a2.parent_id AND d.type='district'
        WHERE d.parent_id = ?)
    )`);
    params.push(lok_sabha_id, lok_sabha_id, lok_sabha_id);
  }

  if (district_id) {
    clauses.push(`(
      ${a}district_id = ?
      OR ${a}assembly_id IN (SELECT id FROM locations WHERE type='assembly' AND parent_id = ?)
    )`);
    params.push(district_id, district_id);
  }

  if (assembly_id) {
    clauses.push(`${a}assembly_id = ?`);
    params.push(assembly_id);
  }

  return { clauses, params };
}
