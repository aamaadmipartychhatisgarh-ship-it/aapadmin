import { query } from "@/lib/db";
import { scopeFilterSync } from "@/lib/permissions";
import { notWrongNumberClause, notPendingClause } from "@/lib/contactExtras";
import { ensureContactDesignationsSchema } from "@/lib/contactDesignations";
import { ensureDesignationLevelColumn } from "@/lib/designationLevels";
import { wingsMapFor } from "@/lib/designationWings";
import { ensureContactWingsSchema } from "@/lib/contactWings";

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
  // "persons" view = the flattened Total-Assigned-Person list (one row per
  // assignment record), server-side paginated. Anything else = the location ×
  // designation matrix (the original behavior).
  const view = opts.view === "persons" ? "persons" : "matrix";
  const page = Number.isInteger(opts.page) && opts.page > 0 ? opts.page : 1;
  const pageSize = Number.isInteger(opts.pageSize) && opts.pageSize > 0 ? Math.min(opts.pageSize, 500) : 50;

  await ensureContactDesignationsSchema();
  await ensureDesignationLevelColumn(query);

  const scope = scopeFilterSync(session.user, "c");
  const notWrong = (await notWrongNumberClause("c")) + (await notPendingClause("c"));

  // The designations mapped to EXACTLY this level in Designation Master (the full
  // list drives the dropdown; the current filter narrows the matrix). A disabled
  // designation (Designation Master enable/disable) is excluded — feature-detected
  // so this stays safe where the `enabled` column doesn't exist yet.
  const hasEnabled = (await query("SHOW COLUMNS FROM designations LIKE 'enabled'")).length > 0;
  const enabledClause = hasEnabled ? "AND (enabled = 1 OR enabled IS NULL)" : "";
  // Wing is an optional column (feature-detected) so every query here stays safe on
  // a DB where the Wings feature hasn't been provisioned yet.
  const hasWing = (await query("SHOW COLUMNS FROM designations LIKE 'wing'")).length > 0;
  const wingSelect = hasWing ? "wing" : "NULL AS wing";
  const levelDesignations = await query(
    `SELECT id, name, ${wingSelect} FROM designations WHERE level = ? ${enabledClause} ORDER BY (sort_order IS NULL), sort_order, name`,
    [level]
  );
  // Every wing of each designation (one entry can carry many); `wing` stays the first.
  const wingsMap = await wingsMapFor(levelDesignations);
  for (const d of levelDesignations) d.wings = wingsMap.get(d.id) || [];
  // Optional wing filter: a set of stored wing names. When present, only
  // designations belonging to one of those wings are kept (empty set of matches →
  // no rows, never "all"). The wing list itself always comes from Master Data.
  const wingFilter = Array.isArray(opts.wings)
    ? opts.wings.map((w) => String(w || "").trim()).filter(Boolean)
    : [];
  const wingSet = wingFilter.length ? new Set(wingFilter) : null;
  // Collapse designations that render to the SAME name at this level into a single
  // vacancy column (case/whitespace-insensitive) so a location never shows the same
  // designation twice (e.g. a stray duplicate row in the master). The representative
  // keeps the lowest sort_order (the list is already in Designation Master order),
  // and EVERY underlying id maps to its name so a position counts as occupied no
  // matter which duplicate designation id a person was actually assigned to.
  const normName = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
  const repByNorm = new Map(); // normName -> representative { id, name, wing } (first wins = best order)
  const idToNorm = new Map();  // every level designation id -> its normalized name
  for (const d of levelDesignations) {
    const nm = normName(d.name);
    idToNorm.set(d.id, nm);
    if (!repByNorm.has(nm)) repByNorm.set(nm, { id: d.id, name: d.name, wing: d.wing || null, wings: d.wings || [] });
  }
  const uniqueLevelDesignations = [...repByNorm.values()];
  // Designations narrowed by the designation filter only; the Wing filter is applied
  // below, once we know which people are saved under which Wing (see "Wing mapping").
  const baseDesignations = uniqueLevelDesignations.filter((d) =>
    !designationId || idToNorm.get(designationId) === normName(d.name)
  );
  const wingsOfDesignationId = new Map(levelDesignations.map((d) => [d.id, d.wings || []]));

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

  // District each location belongs to (display colour grouping only): a district is
  // its own; an assembly's parent is its district; a block (ward) sits under an
  // assembly. State / Zone / Lok Sabha rows span districts, so they have none.
  const districtOf = new Map(); // location id -> { id, name } | null
  if (level === "district" || level === "assembly" || level === "block") {
    const hier = await query("SELECT id, name, type, parent_id FROM locations WHERE type IN ('district','assembly','ward')");
    const byId = new Map(hier.map((x) => [x.id, x]));
    const resolve = (x) => {
      let cur = x, guard = 0;
      while (cur && guard++ < 4) { if (cur.type === "district") return { id: cur.id, name: cur.name }; cur = byId.get(cur.parent_id); }
      return null;
    };
    for (const l of allLocations) districtOf.set(l.id, resolve(byId.get(l.id)));
  }

  // People holding a designation OF THIS LEVEL, tagged with their location id at
  // this level. Strict join designations.level = ? — a person only ever appears
  // for a designation actually mapped to this level.
  let peopleRows;
  if (level === "state") {
    peopleRows = await query(
      `SELECT 0 AS loc_id, cd.designation_id, c.id AS contact_id, c.person_name, c.phone_number,
              COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) AS photo_url,
              lac.name AS assembly_name
         FROM contacts c
         JOIN contact_designations cd ON cd.contact_id = c.id
         JOIN designations d ON d.id = cd.designation_id AND d.level = 'state'
         LEFT JOIN workers w ON w.id = c.worker_id
         LEFT JOIN locations lac ON lac.id = c.assembly_id
        WHERE 1=1 ${notWrong} ${scope.where}
        ORDER BY c.person_name
        LIMIT ${MAX_PEOPLE}`,
      [...scope.params]
    );
  } else {
    const levelIdExpr = LEVEL_ID_EXPR[level];
    peopleRows = await query(
      `SELECT ${levelIdExpr} AS loc_id, cd.designation_id, c.id AS contact_id, c.person_name, c.phone_number,
              COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) AS photo_url,
              lac.name AS assembly_name,
              c.lok_sabha_id AS raw_lok_sabha_id, c.district_id AS raw_district_id, c.assembly_id AS raw_assembly_id
         FROM contacts c
         JOIN contact_designations cd ON cd.contact_id = c.id
         JOIN designations d ON d.id = cd.designation_id AND d.level = ?
         LEFT JOIN workers w ON w.id = c.worker_id
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations lls ON lls.id = ld.parent_id
         LEFT JOIN locations lz ON lz.id = lls.parent_id
         LEFT JOIN locations lac ON lac.id = c.assembly_id
        WHERE 1=1 ${notWrong} ${scope.where}
        ORDER BY c.person_name
        LIMIT ${MAX_PEOPLE}`,
      [level, ...scope.params]
    );
  }

  // ---- Wing mapping ---------------------------------------------------------------
  // Which Wing a person is listed under comes from THEIR saved Contact record
  // (contact_wings — what the Contacts edit form's Wings field saves). Read live, so
  // changing a contact's Wing there moves the same record (same contact id, no copy)
  // to the new Wing section here and removes it from the old one.
  // A contact with NO saved Wing keeps the existing workflow: it is listed under the
  // Wing(s) of the designation it holds. With no Wing filter nothing changes.
  let designations = baseDesignations;
  let personMatchesWing = () => true;
  if (wingSet) {
    await ensureContactWingsSchema();
    const cwMap = new Map(); // contact id -> saved wing names
    const cids = [...new Set(peopleRows.map((r) => r.contact_id))];
    for (let i = 0; i < cids.length; i += 1000) {
      const chunk = cids.slice(i, i + 1000);
      // eslint-disable-next-line no-await-in-loop
      // No .catch: a failed lookup must surface as an error, never silently drop
      // holders (which would turn filled positions into false vacancies).
      const rows = await query(`SELECT contact_id, wing FROM contact_wings WHERE contact_id IN (${chunk.map(() => "?").join(",")})`, chunk);
      for (const w of rows) { if (!cwMap.has(w.contact_id)) cwMap.set(w.contact_id, []); cwMap.get(w.contact_id).push(w.wing); }
    }
    const effectiveWings = (r) => {
      const saved = cwMap.get(r.contact_id);
      return saved && saved.length ? saved : (wingsOfDesignationId.get(r.designation_id) || []);
    };
    personMatchesWing = (r) => effectiveWings(r).some((w) => wingSet.has(w));
    // A designation column is shown under a Wing when the designation belongs to it OR
    // someone saved under that Wing holds it (so a worker saved under Wing X is visible
    // even when their designation is a general one).
    const shown = new Set();
    for (const d of baseDesignations) if ((d.wings || []).some((w) => wingSet.has(w))) shown.add(normName(d.name));
    for (const r of peopleRows) if (personMatchesWing(r)) shown.add(idToNorm.get(r.designation_id) || normName(r.designation_name));
    designations = baseDesignations.filter((d) => shown.has(normName(d.name)));
  }
  const allowedNorms = new Set(designations.map((d) => normName(d.name)));

  // Bucket assigned people by EXACT (location id : designation id). A holder whose
  // location AT THIS LEVEL is missing, or is not a real location of this level in
  // the master, is NOT counted against any position: it is collected as an
  // UNMAPPED holder instead (a data problem, reported separately — see below).
  const validLocIds = level === "state" ? null : new Set(allLocations.map((l) => l.id));
  const unmapped = [];
  const bucket = new Map();
  for (const r of peopleRows) {
    const nm = idToNorm.get(r.designation_id) || normName(r.designation_name);
    if (!allowedNorms.has(nm)) continue;
    if (!personMatchesWing(r)) continue;
    if (validLocIds && (r.loc_id == null || !validLocIds.has(Number(r.loc_id)))) {
      unmapped.push({
        contact_id: r.contact_id, person_name: r.person_name, norm: nm,
        designation_id: r.designation_id,
        designation_name: (repByNorm.get(nm) || {}).name || null,
        reason: r.loc_id == null
          ? `No ${LEVEL_LABEL[level]} saved on the contact`
          : `Saved ${LEVEL_LABEL[level]} (id ${r.loc_id}) is not a valid ${LEVEL_LABEL[level]} in the location master`,
        raw: { lok_sabha: r.raw_lok_sabha_id ?? null, district: r.raw_district_id ?? null, assembly: r.raw_assembly_id ?? null },
      });
      continue;
    }
    const loc = r.loc_id ?? 0;
    const key = `${loc}:${nm}`;
    if (!bucket.has(key)) bucket.set(key, []);
    // assembly_name = the worker's OWN saved Assembly (contacts.assembly_id), or null.
    bucket.get(key).push({ id: r.contact_id, person_name: r.person_name, phone_number: r.phone_number || null, photo_url: r.photo_url, assembly_name: r.assembly_name || null });
  }

  // Where could an unmapped holder belong? Narrowed by the most specific VALID
  // higher-level location saved on their contact (e.g. an Assembly-level holder
  // with a valid District can only be in that District's assemblies); with none,
  // any location of this level is possible.
  let couldBeAt = () => false;
  if (unmapped.length) {
    const all = await query("SELECT id, type, parent_id FROM locations");
    const byId = new Map(all.map((x) => [x.id, x]));
    const isType = (id, t) => id != null && byId.get(Number(id))?.type === t;
    const anchorTypes = { lok_sabha: [], district: ["lok_sabha"], assembly: ["district", "lok_sabha"], block: ["assembly", "district", "lok_sabha"], zone: [] }[level] || [];
    for (const u of unmapped) {
      u.anchor = null;
      for (const t of anchorTypes) {
        const id = t === "lok_sabha" ? u.raw.lok_sabha : t === "district" ? u.raw.district : u.raw.assembly;
        if (isType(id, t === "assembly" ? "assembly" : t)) { u.anchor = Number(id); break; }
      }
    }
    const under = (locId, anchor) => {
      let cur = byId.get(locId), guard = 0;
      while (cur && guard++ < 12) { if (cur.id === anchor) return true; cur = cur.parent_id != null ? byId.get(cur.parent_id) : null; }
      return false;
    };
    couldBeAt = (u, locId) => u.anchor == null || under(locId, u.anchor);
  }

  // Build one row per (location × level-designation). FILLED iff ≥1 person is
  // mapped to that exact location. An unfilled position is NEEDS REVIEW (not
  // vacant) when an unmapped holder of the same designation could belong to it.
  const allRows = [];
  for (const loc of locations) {
    for (const d of designations) {
      const people = bucket.get(`${loc.id}:${normName(d.name)}`) || [];
      const reviewBy = people.length ? [] : unmapped.filter((u) => u.norm === normName(d.name) && couldBeAt(u, loc.id));
      allRows.push({
        location_id: loc.id,
        location_name: loc.name,
        district_id: districtOf.get(loc.id)?.id ?? null,
        district_name: districtOf.get(loc.id)?.name ?? null,
        designation_id: d.id,
        designation_name: d.name,
        designation_wing: d.wing || null,
        designation_wings: d.wings || [],
        people,
        person_names: people.map((p) => p.person_name).join(", "),
        filled: people.length > 0,
        // filled | vacant | review (an unmapped holder may fill it — check the data)
        status: people.length > 0 ? "filled" : reviewBy.length ? "review" : "vacant",
        review_people: reviewBy.map((u) => ({ contact_id: u.contact_id, person_name: u.person_name, reason: u.reason })),
      });
    }
  }

  // Flatten every assignment into ONE record per (person × filled slot) — the
  // authoritative "Total Assigned Person" dataset. A person assigned to several
  // assemblies / designations yields several records (each a valid assignment,
  // never removed), while `assigned_unique` counts distinct people. Built over
  // allRows, so it is independent of the filled/blank filter and reflects the
  // COMPLETE scoped database dataset — the source for both the count and the list.
  const assignedPersons = [];
  const uniquePersons = new Set();
  for (const row of allRows) {
    for (const p of row.people) {
      uniquePersons.add(p.id);
      assignedPersons.push({
        contact_id: p.id,
        person_name: p.person_name,
        photo_url: p.photo_url,
        assembly_name: p.assembly_name || null,
        designation_id: row.designation_id,
        designation_name: row.designation_name,
        designation_wing: row.designation_wing || null,
        location_id: row.location_id,
        location_name: row.location_name,
        district_id: row.district_id ?? null,
        district_name: row.district_name ?? null,
      });
    }
  }
  // Stable order: person A→Z, then location, then designation.
  assignedPersons.sort((a, b) =>
    String(a.person_name || "").localeCompare(String(b.person_name || "")) ||
    String(a.location_name || "").localeCompare(String(b.location_name || "")) ||
    String(a.designation_name || "").localeCompare(String(b.designation_name || ""))
  );

  // Counts over the current level + designation + location scope (independent of
  // the filled/blank filter, so the breakdown is always visible). assigned_persons
  // = total assignment records (the card's headline count); assigned_unique =
  // distinct people behind them.
  const counts = {
    total: allRows.length,
    filled: allRows.filter((r) => r.filled).length,
    blank: allRows.filter((r) => !r.filled).length,
    // Of the blank rows: genuinely vacant vs possibly filled by an unmapped holder.
    vacant: allRows.filter((r) => r.status === "vacant").length,
    review: allRows.filter((r) => r.status === "review").length,
    assigned_persons: assignedPersons.length,
    assigned_unique: uniquePersons.size,
  };

  // PERSONS VIEW — the Total-Assigned-Person drill-down, server-side paginated.
  // `persons_total` is the count over the complete dataset (matches the card), and
  // only the requested page slice is returned.
  if (view === "persons") {
    const total = assignedPersons.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    return {
      level,
      level_label: LEVEL_LABEL[level],
      view: "persons",
      status,
      level_designations: uniqueLevelDesignations,
      all_locations: allLocations,
      persons: assignedPersons.slice(start, start + pageSize),
      persons_total: total,
      pagination: { page: safePage, pageSize, total, totalPages },
      counts,
      capped: peopleRows.length >= MAX_PEOPLE,
    };
  }

  const rows = status === "filled" ? allRows.filter((r) => r.filled)
    : status === "blank" ? allRows.filter((r) => !r.filled)
    : allRows;

  return {
    level,
    level_label: LEVEL_LABEL[level],
    view: "matrix",
    status,
    level_designations: uniqueLevelDesignations,
    all_locations: allLocations,
    rows,
    counts,
    // Holders of this level's designations whose location mapping is missing or
    // invalid — reported, never counted as filling (or freeing) a position.
    unmapped_holders: unmapped.map(({ norm, raw, anchor, ...u }) => u),
    capped: peopleRows.length >= MAX_PEOPLE,
  };
}
