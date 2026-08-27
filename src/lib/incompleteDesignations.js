import { query } from "@/lib/db";
import { scopeFilterSync } from "@/lib/permissions";
import { notWrongNumberClause } from "@/lib/contactExtras";
import { ensureContactDesignationsSchema } from "@/lib/contactDesignations";
import { ensureDesignationLevelColumn } from "@/lib/designationLevels";

// CONTACTS → INCOMPLETE DESIGNATION — shared data layer.
//
// SINGLE SOURCE OF TRUTH: the Designation Master (`designations` table) and its
// `level` column decide which designation belongs to which level. Nothing here
// is hardcoded — designations, their level mapping, the location hierarchy and
// the assignments are all read live, so anything added in the masters shows up
// automatically.
//
// For a chosen LEVEL we build one row per (location × designation-of-that-level)
// and attach the person(s) assigned to that EXACT location + designation. A row
// is FILLED when at least one valid person is assigned, otherwise BLANK. A person
// is only ever matched to their own location + their own level-designation, so a
// District person can never appear at Lok Sabha, and a Lok-Sabha-B holder never
// shows against Lok Sabha A.
//
// Both the page API and the PDF/Excel export call THIS function with the same
// inputs, so the exported file always matches exactly what the page shows.

export const LEVELS = ["state", "zone", "lok_sabha", "district", "assembly", "block"];
export const LEVEL_LABEL = {
  state: "State", zone: "Zone", lok_sabha: "Lok Sabha",
  district: "District", assembly: "Assembly", block: "Block",
};

// The contact's location id at a given level: its own column, or derived up the
// district hierarchy for zone / lok_sabha.
const LEVEL_ID_EXPR = {
  zone: "COALESCE(c.zone_id, lz.id)",
  lok_sabha: "COALESCE(c.lok_sabha_id, lls.id)",
  district: "c.district_id",
  assembly: "c.assembly_id",
  block: "c.ward_id",
};
// The location master `type` for each level (block = ward).
const LOC_TYPE = { zone: "zone", lok_sabha: "lok_sabha", district: "district", assembly: "assembly", block: "ward" };
const MAX_PEOPLE = 8000;
const MAX_LOCS = 5000;

export function normalizeLevel(v) {
  const level = String(v || "state").toLowerCase();
  return LEVELS.includes(level) ? level : null;
}

// Resolve the full Incomplete-Designation dataset for a level (+ optional
// designation / location / filled|blank filters). Returns the display rows AND
// the total/filled/blank counts over the current level+designation+location
// scope (the counts ignore the filled/blank filter, so they always show the full
// breakdown). Everything a caller needs to render the table OR export it.
export async function fetchIncompleteDesignation(session, opts = {}) {
  const level = normalizeLevel(opts.level);
  if (!level) throw new Error("Invalid level");

  const designationId = Number.isInteger(opts.designationId) && opts.designationId > 0 ? opts.designationId : null;
  const locationId = Number.isInteger(opts.locationId) && opts.locationId > 0 ? opts.locationId : null;
  const status = ["filled", "blank"].includes(opts.status) ? opts.status : "all";

  await ensureContactDesignationsSchema();
  await ensureDesignationLevelColumn(query);

  const scope = scopeFilterSync(session.user, "c");
  const notWrong = await notWrongNumberClause("c");

  // The designations mapped to EXACTLY this level in Designation Master (the full
  // list drives the dropdown; the current filter narrows the matrix).
  const levelDesignations = await query(
    `SELECT id, name FROM designations WHERE level = ? ORDER BY (sort_order IS NULL), sort_order, name`,
    [level]
  );
  const designations = designationId ? levelDesignations.filter((d) => d.id === designationId) : levelDesignations;
  const allowedDes = new Set(designations.map((d) => d.id));

  // Every location of this level (State is a single pseudo-location). New master
  // locations appear here automatically.
  let allLocations;
  if (level === "state") {
    allLocations = [{ id: 0, name: "State" }];
  } else {
    const masterLocs = await query(
      `SELECT id, name FROM locations WHERE type = ? ORDER BY name LIMIT ${MAX_LOCS}`,
      [LOC_TYPE[level]]
    );
    allLocations = masterLocs.map((l) => ({ id: l.id, name: l.name }));
  }
  const locations = locationId != null ? allLocations.filter((l) => l.id === locationId) : allLocations;

  // People holding a designation OF THIS LEVEL, tagged with their location id at
  // this level. Strict join designations.level = ? — a person only ever appears
  // for a designation actually mapped to this level.
  let peopleRows;
  if (level === "state") {
    peopleRows = await query(
      `SELECT 0 AS loc_id, cd.designation_id, c.id AS contact_id, c.person_name,
              COALESCE(c.photo_url, w.photo_url) AS photo_url
         FROM contacts c
         JOIN contact_designations cd ON cd.contact_id = c.id
         JOIN designations d ON d.id = cd.designation_id AND d.level = 'state'
         LEFT JOIN workers w ON w.id = c.worker_id
        WHERE 1=1 ${notWrong} ${scope.where}
        ORDER BY c.person_name
        LIMIT ${MAX_PEOPLE}`,
      [...scope.params]
    );
  } else {
    const levelIdExpr = LEVEL_ID_EXPR[level];
    peopleRows = await query(
      `SELECT ${levelIdExpr} AS loc_id, cd.designation_id, c.id AS contact_id, c.person_name,
              COALESCE(c.photo_url, w.photo_url) AS photo_url
         FROM contacts c
         JOIN contact_designations cd ON cd.contact_id = c.id
         JOIN designations d ON d.id = cd.designation_id AND d.level = ?
         LEFT JOIN workers w ON w.id = c.worker_id
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations lls ON lls.id = ld.parent_id
         LEFT JOIN locations lz ON lz.id = lls.parent_id
        WHERE 1=1 ${notWrong} ${scope.where}
        ORDER BY c.person_name
        LIMIT ${MAX_PEOPLE}`,
      [level, ...scope.params]
    );
  }

  // Bucket assigned people by EXACT (location id : designation id).
  const bucket = new Map();
  for (const r of peopleRows) {
    if (!allowedDes.has(r.designation_id)) continue;
    const loc = r.loc_id ?? 0;
    const key = `${loc}:${r.designation_id}`;
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key).push({ id: r.contact_id, person_name: r.person_name, photo_url: r.photo_url });
  }

  // Build one row per (location × level-designation). FILLED iff ≥1 person.
  const allRows = [];
  for (const loc of locations) {
    for (const d of designations) {
      const people = bucket.get(`${loc.id}:${d.id}`) || [];
      allRows.push({
        location_id: loc.id,
        location_name: loc.name,
        designation_id: d.id,
        designation_name: d.name,
        people,
        person_names: people.map((p) => p.person_name).join(", "),
        filled: people.length > 0,
      });
    }
  }

  // Counts over the current level + designation + location scope (independent of
  // the filled/blank filter, so the breakdown is always visible).
  const counts = {
    total: allRows.length,
    filled: allRows.filter((r) => r.filled).length,
    blank: allRows.filter((r) => !r.filled).length,
  };

  const rows = status === "filled" ? allRows.filter((r) => r.filled)
    : status === "blank" ? allRows.filter((r) => !r.filled)
    : allRows;

  return {
    level,
    level_label: LEVEL_LABEL[level],
    status,
    level_designations: levelDesignations,
    all_locations: allLocations,
    rows,
    counts,
    capped: peopleRows.length >= MAX_PEOPLE,
  };
}
