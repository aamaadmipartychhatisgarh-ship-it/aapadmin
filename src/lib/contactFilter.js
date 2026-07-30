// Shared people-filter for the calling pipeline (Contacts list + Distribution),
// so the SAME zone/designation selection returns the SAME people as the Workers
// page. A person's truth lives on their WORKER row (full geography + all roles as
// free text in `position`); a contact carries only a single primary
// designation_id and sometimes drifted geography. So we filter each contact by
// its LINKED worker's attributes (person-aware), falling back to the contact's
// own columns only when it has no worker link.
//
// Geography roll-up and designation matching here are identical to the Workers
// route (zone/Lok Sabha roll up through the location tree; a designation matches
// if it appears anywhere in the multi-value position text). Requires the query to
// LEFT JOIN workers w ON w.id = c.worker_id (see `needsWorkerJoin`).

// Hierarchical geo predicate on a table alias (same logic as the Workers page).
function geoParts(alias, { zone_id, lok_sabha_id, district_id, assembly_ids }) {
  const a = alias ? `${alias}.` : "";
  const parts = [];
  const params = [];
  if (zone_id) {
    parts.push(`(
      ${a}zone_id = ?
      OR ${a}lok_sabha_id IN (SELECT id FROM locations WHERE type='lok_sabha' AND parent_id = ?)
      OR ${a}district_id IN (
        SELECT d.id FROM locations d
        JOIN locations ls ON ls.id = d.parent_id AND ls.type='lok_sabha'
        WHERE ls.parent_id = ?)
      OR ${a}assembly_id IN (
        SELECT x.id FROM locations x
        JOIN locations d ON d.id = x.parent_id AND d.type='district'
        JOIN locations ls ON ls.id = d.parent_id AND ls.type='lok_sabha'
        WHERE ls.parent_id = ?)
    )`);
    params.push(zone_id, zone_id, zone_id, zone_id);
  }
  if (lok_sabha_id) {
    parts.push(`(
      ${a}lok_sabha_id = ?
      OR ${a}district_id IN (SELECT id FROM locations WHERE type='district' AND parent_id = ?)
      OR ${a}assembly_id IN (
        SELECT x.id FROM locations x
        JOIN locations d ON d.id = x.parent_id AND d.type='district'
        WHERE d.parent_id = ?)
    )`);
    params.push(lok_sabha_id, lok_sabha_id, lok_sabha_id);
  }
  if (district_id) { parts.push(`${a}district_id = ?`); params.push(district_id); }
  if (assembly_ids?.length) {
    parts.push(`${a}assembly_id IN (${assembly_ids.map(() => "?").join(",")})`);
    params.push(...assembly_ids);
  }
  return { parts, params };
}

// Designation predicate against a worker's free-text `position` (multi-role): a
// contact matches if ANY selected designation's name appears in the position.
function workerDesignationPart(designation_ids) {
  if (!designation_ids?.length) return null;
  const each = designation_ids.map(
    () => `FIND_IN_SET((SELECT name FROM designations WHERE id = ?), REPLACE(w.position, ', ', ','))`
  );
  return { clause: `(${each.join(" OR ")})`, params: [...designation_ids] };
}

// Build the person-aware WHERE fragment for contacts (alias c). Returns an
// " AND (…)" string + params, and whether a workers join is required.
export function buildContactPersonFilter({ zone_id, lok_sabha_id, district_id, assembly_ids, designation_ids } = {}) {
  const geo = { zone_id, lok_sabha_id, district_id, assembly_ids };

  // Worker-side (person truth).
  const wGeo = geoParts("w", geo);
  const wDes = workerDesignationPart(designation_ids);
  const workerConds = [...wGeo.parts];
  const workerParams = [...wGeo.params];
  if (wDes) { workerConds.push(wDes.clause); workerParams.push(...wDes.params); }

  // Contact-own fallback (for contacts with no worker link).
  const cGeo = geoParts("c", geo);
  const ownConds = [...cGeo.parts];
  const ownParams = [...cGeo.params];
  if (designation_ids?.length) {
    ownConds.push(`c.designation_id IN (${designation_ids.map(() => "?").join(",")})`);
    ownParams.push(...designation_ids);
  }

  if (workerConds.length === 0) return { where: "", params: [], needsWorkerJoin: false };

  const clause = `AND (
    (c.worker_id IS NOT NULL AND ${workerConds.join(" AND ")})
    OR (c.worker_id IS NULL AND ${ownConds.join(" AND ")})
  )`;
  return { where: " " + clause, params: [...workerParams, ...ownParams], needsWorkerJoin: true };
}
