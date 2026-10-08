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
export function buildContactPersonFilter({ zone_id, lok_sabha_id, district_id, assembly_ids, designation_ids, wings } = {}) {
  const geo = { zone_id, lok_sabha_id, district_id, assembly_ids };
  const wingList = Array.isArray(wings) ? wings.filter(Boolean) : [];

  // A contact matches the designation/wing filter if ANY of its OWN designations
  // (the multi-value contact_designations join, PROMPT 5) is a selected designation
  // OR belongs to a selected wing, OR the contact carries the selected wing as a
  // SAVED tag (contact_wings). This covers legacy single-designation contacts
  // (backfilled into the join), new multi-designation ones, and contacts tagged
  // with a wing directly — on either the worker or the own branch. A wing with no
  // matching designations/tags correctly matches nothing (never "all").
  const desExists = (designation_ids?.length || wingList.length)
    ? (() => {
        const clauses = [];
        const params = [];
        // Designation-based match (explicit ids and/or wing-of-designation).
        const subs = [];
        const subParams = [];
        if (designation_ids?.length) {
          subs.push(`cd.designation_id IN (${designation_ids.map(() => "?").join(",")})`);
          subParams.push(...designation_ids);
        }
        if (wingList.length) {
          subs.push(`dw.wing IN (${wingList.map(() => "?").join(",")})`);
          subParams.push(...wingList);
        }
        const join = wingList.length ? "JOIN designations dw ON dw.id = cd.designation_id" : "";
        clauses.push(`EXISTS (SELECT 1 FROM contact_designations cd ${join} WHERE cd.contact_id = c.id AND (${subs.join(" OR ")}))`);
        params.push(...subParams);
        // Saved wing-tag match (contact_wings), so a contact tagged with the wing
        // is found even if none of its designations belong to that wing.
        if (wingList.length) {
          clauses.push(`EXISTS (SELECT 1 FROM contact_wings cwf WHERE cwf.contact_id = c.id AND cwf.wing IN (${wingList.map(() => "?").join(",")}))`);
          params.push(...wingList);
        }
        return { clause: `(${clauses.join(" OR ")})`, params };
      })()
    : null;

  // Worker-side (person truth).
  const wGeo = geoParts("w", geo);
  const wDes = workerDesignationPart(designation_ids);
  const workerConds = [...wGeo.parts];
  const workerParams = [...wGeo.params];
  if (desExists) {
    // ONE authoritative designation source: the contact's OWN set
    // (contact_designations), which the edit flow keeps current. The worker's
    // free-text `position` is only a FALLBACK for contacts that have NO
    // designations of their own — because that text is NOT rewritten when a
    // contact's designation is changed, so left as an OR it would keep matching
    // the OLD designation after an edit (e.g. "Vidhansabha Prabhari" still hits a
    // member now set to "Member"). So a contact that HAS designations is matched
    // strictly by its current set.
    const parts = [desExists.clause];
    workerParams.push(...desExists.params);
    if (wDes) {
      parts.push(`(NOT EXISTS (SELECT 1 FROM contact_designations cdx WHERE cdx.contact_id = c.id) AND ${wDes.clause})`);
      workerParams.push(...wDes.params);
    }
    workerConds.push(`(${parts.join(" OR ")})`);
  }

  // Contact-own fallback (for contacts with no worker link). A wings-only filter
  // (no explicit designation ids) still applies here via the shared EXISTS.
  const cGeo = geoParts("c", geo);
  const ownConds = [...cGeo.parts];
  const ownParams = [...cGeo.params];
  if (desExists) {
    const parts = [];
    if (designation_ids?.length) {
      parts.push(`c.designation_id IN (${designation_ids.map(() => "?").join(",")})`);
      ownParams.push(...designation_ids);
    }
    parts.push(desExists.clause);
    ownParams.push(...desExists.params);
    ownConds.push(`(${parts.join(" OR ")})`);
  }

  if (workerConds.length === 0) return { where: "", params: [], needsWorkerJoin: false };

  const clause = `AND (
    (c.worker_id IS NOT NULL AND ${workerConds.join(" AND ")})
    OR (c.worker_id IS NULL AND ${ownConds.join(" AND ")})
  )`;
  return { where: " " + clause, params: [...workerParams, ...ownParams], needsWorkerJoin: true };
}
