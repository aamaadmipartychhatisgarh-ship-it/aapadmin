// Hierarchical geography filter for a table that carries zone_id / lok_sabha_id /
// district_id / assembly_id (contacts, workers, calls). Returns { clauses, params }
// to splice into a WHERE.
//
// Zone/Lok-Sabha matching rolls up through the location tree so a row that only
// has district_id or assembly_id set still matches its ancestor zone/Lok Sabha
// (many imported contacts have no zone_id/lok_sabha_id). District matches its own
// id or an assembly under it; assembly is an exact match.
// Strict "caller's own zone" scope. A contact belongs to the zone when its
// zone_id equals it. When zone_id is NULL, fall back to a district/assembly
// roll-up through the location tree (or keep contacts that have no geography at
// all). A contact whose zone_id is explicitly set to ANOTHER zone is always
// excluded — an explicit zone_id is authoritative and never overridden.
export function zoneScope(alias, zoneId) {
  const a = alias ? `${alias}.` : "";
  const clause = `(
    ${a}zone_id = ?
    OR (${a}zone_id IS NULL AND (
      ${a}lok_sabha_id IN (SELECT id FROM locations WHERE type='lok_sabha' AND parent_id = ?)
      OR ${a}district_id IN (
        SELECT d.id FROM locations d
        JOIN locations ls ON ls.id = d.parent_id AND ls.type='lok_sabha'
        WHERE ls.parent_id = ?)
      OR ${a}assembly_id IN (
        SELECT a2.id FROM locations a2
        JOIN locations d ON d.id = a2.parent_id AND d.type='district'
        JOIN locations ls ON ls.id = d.parent_id AND ls.type='lok_sabha'
        WHERE ls.parent_id = ?)
      OR (${a}lok_sabha_id IS NULL AND ${a}district_id IS NULL AND ${a}assembly_id IS NULL)
    ))
  )`;
  return { clause, params: [zoneId, zoneId, zoneId, zoneId] };
}

// Each of zone_id / lok_sabha_id / district_id / assembly_id / ward_id / booth_id
// may be a single id, a comma-separated string ("1,3"), or an array ([1,3]) —
// multi-select. Within a level the ids are OR'd (WHERE ... IN (…)); across
// levels the clauses are AND'd by the caller, preserving the Zone → Lok Sabha →
// District → Assembly → Ward (Block) → Booth hierarchy. "Ward" is what the
// rest of the app labels "Block" — same location type and column, just a
// different display label depending on screen.
export function geoFilter(alias, { zone_id, lok_sabha_id, district_id, assembly_id, ward_id, booth_id } = {}) {
  const a = alias ? `${alias}.` : "";
  const clauses = [];
  const params = [];
  const arr = (v) =>
    (v == null ? [] : Array.isArray(v) ? v : String(v).split(","))
      .map((x) => String(x).trim())
      .filter(Boolean);
  const ph = (n) => Array(n).fill("?").join(",");

  const zones = arr(zone_id), ls = arr(lok_sabha_id), ds = arr(district_id), asm = arr(assembly_id);
  const wards = arr(ward_id), booths = arr(booth_id);

  // Roll-up matching is STRICT on an explicitly-set id (mirrors zoneScope): a row
  // whose own id at a level is set must be one of the selected ids; only when
  // that id is NULL do we roll up through a more specific level. This keeps
  // filtering predictable (a contact tagged to Lok Sabha X never shows when only
  // Y/Z are selected) while still matching the many imported rows that carry only
  // a district/assembly and no lok_sabha_id.
  if (zones.length) {
    const p = ph(zones.length);
    clauses.push(`(
      ${a}zone_id IN (${p})
      OR (${a}zone_id IS NULL AND (
        ${a}lok_sabha_id IN (SELECT id FROM locations WHERE type='lok_sabha' AND parent_id IN (${p}))
        OR ${a}district_id IN (
          SELECT d.id FROM locations d
          JOIN locations lz ON lz.id = d.parent_id AND lz.type='lok_sabha'
          WHERE lz.parent_id IN (${p}))
        OR ${a}assembly_id IN (
          SELECT a2.id FROM locations a2
          JOIN locations d ON d.id = a2.parent_id AND d.type='district'
          JOIN locations lz ON lz.id = d.parent_id AND lz.type='lok_sabha'
          WHERE lz.parent_id IN (${p}))
      ))
    )`);
    params.push(...zones, ...zones, ...zones, ...zones);
  }

  if (ls.length) {
    const p = ph(ls.length);
    clauses.push(`(
      ${a}lok_sabha_id IN (${p})
      OR (${a}lok_sabha_id IS NULL AND (
        ${a}district_id IN (SELECT id FROM locations WHERE type='district' AND parent_id IN (${p}))
        OR ${a}assembly_id IN (
          SELECT a2.id FROM locations a2
          JOIN locations d ON d.id = a2.parent_id AND d.type='district'
          WHERE d.parent_id IN (${p}))
      ))
    )`);
    params.push(...ls, ...ls, ...ls);
  }

  if (ds.length) {
    const p = ph(ds.length);
    clauses.push(`(
      ${a}district_id IN (${p})
      OR (${a}district_id IS NULL AND ${a}assembly_id IN (SELECT id FROM locations WHERE type='assembly' AND parent_id IN (${p})))
    )`);
    params.push(...ds, ...ds);
  }

  if (asm.length) {
    const p = ph(asm.length);
    clauses.push(`(
      ${a}assembly_id IN (${p})
      OR (${a}assembly_id IS NULL AND ${a}ward_id IN (SELECT id FROM locations WHERE type='ward' AND parent_id IN (${p})))
    )`);
    params.push(...asm, ...asm);
  }

  if (wards.length) {
    const p = ph(wards.length);
    clauses.push(`(
      ${a}ward_id IN (${p})
      OR (${a}ward_id IS NULL AND ${a}booth_id IN (SELECT id FROM locations WHERE type='booth' AND parent_id IN (${p})))
    )`);
    params.push(...wards, ...wards);
  }

  if (booths.length) {
    clauses.push(`${a}booth_id IN (${ph(booths.length)})`);
    params.push(...booths);
  }

  return { clauses, params };
}
