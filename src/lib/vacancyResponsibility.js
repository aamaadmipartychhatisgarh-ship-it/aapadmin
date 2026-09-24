import { query } from "@/lib/db";
import { ensureContactDesignationsSchema } from "@/lib/contactDesignations";
import { ensureDesignationLevelColumn } from "@/lib/designationLevels";
import { ensureLocationSortOrder } from "@/lib/locationOrder";

// VACANCY RESPONSIBILITY — who must fill a vacant organizational designation.
//
// The responsible person is derived AUTOMATICALLY from the real State → Lok Sabha
// → District → Assembly → Block hierarchy (locations.parent_id) and the actual
// Designation Master assignments (contact_designations). Nothing here is
// hardcoded per-vacancy: for a vacancy at a given team level we look up the person
// holding a specific leadership designation at the PARENT area.
//
//   Team level (vacancy)  →  Responsible designation(s)         resolved at
//   --------------------     -------------------------------    ------------------
//   Lok Sabha             →  State Working President            State (single)
//   District              →  Lok Sabha Prabhari + President     parent Lok Sabha
//   Assembly              →  District President                 parent District
//   Block                 →  Assembly Prabhari + President       parent Assembly
//
// If nobody holds the responsible designation, the vacancy is surfaced as
// "Responsible Person Not Assigned" (never silently dropped).

// The location-master `type` for each vacancy team level (block = ward).
const LEVEL_TYPE = { lok_sabha: "lok_sabha", district: "district", assembly: "assembly", block: "ward" };

// The responsibility mapping. `respLevel` is the hierarchy level the responsible
// person sits at; `names` are the designation phrases (matched case-insensitively,
// substring-tolerant) that identify them there.
export const RESPONSIBILITY = {
  lok_sabha: { respLevel: "state", names: ["state working president"] },
  district: { respLevel: "lok_sabha", names: ["lok sabha prabhari", "lok sabha president"] },
  assembly: { respLevel: "district", names: ["district president"] },
  block: { respLevel: "assembly", names: ["assembly prabhari", "assembly president"] },
};

export const RESPONSIBILITY_LABEL = {
  lok_sabha: "State Working President",
  district: "Lok Sabha Prabhari + Lok Sabha President",
  assembly: "District President",
  block: "Assembly Prabhari + Assembly President",
};

// The team levels that have a defined responsibility mapping (State designations
// have no higher authority to chase, so they are excluded from reminders).
export const TEAM_LEVELS = ["lok_sabha", "district", "assembly", "block"];

// The person's location id AT a responsible level, derived up the district chain
// for lok_sabha (mirrors incompleteDesignations' LEVEL_ID_EXPR).
const RESP_LOC_EXPR = {
  lok_sabha: "COALESCE(c.lok_sabha_id, lls.id)",
  district: "c.district_id",
  assembly: "c.assembly_id",
};

// Load the full location index once: id → { id, name, type, parent_id }.
export async function loadLocationIndex() {
  await ensureLocationSortOrder();
  const rows = await query("SELECT id, name, type, parent_id, sort_order FROM locations");
  const map = new Map();
  for (const r of rows) map.set(r.id, { id: r.id, name: r.name, type: r.type, parent_id: r.parent_id, sort_order: r.sort_order });
  return map;
}

// Walk up parent_id and return the ancestor of a given master type (or null).
function ancestorOfType(index, locId, type) {
  let cur = index.get(locId);
  let guard = 0;
  while (cur && guard++ < 12) {
    if (cur.type === type) return cur;
    cur = cur.parent_id != null ? index.get(cur.parent_id) : null;
  }
  return null;
}

// Full ancestry names for a location id (block=ward), used to render and filter
// the vacancy row across every hierarchy column.
export function ancestryOf(index, level, locId) {
  const selfType = LEVEL_TYPE[level];
  const out = {
    lok_sabha_id: null, lok_sabha_name: null,
    district_id: null, district_name: null,
    assembly_id: null, assembly_name: null,
    block_id: null, block_name: null,
  };
  if (level === "state") return out;
  const self = index.get(locId);
  if (!self) return out;
  const put = (t) => {
    const n = t === selfType ? self : ancestorOfType(index, locId, t);
    return n ? { id: n.id, name: n.name } : { id: null, name: null };
  };
  const ls = put("lok_sabha"); out.lok_sabha_id = ls.id; out.lok_sabha_name = ls.name;
  const di = put("district"); out.district_id = di.id; out.district_name = di.name;
  const as = put("assembly"); out.assembly_id = as.id; out.assembly_name = as.name;
  const bl = put("ward"); out.block_id = bl.id; out.block_name = bl.name;
  return out;
}

// Load every current holder of a responsibility designation, bucketed by
// respLevel → locationId → [{ contact_id, person_name, mobile, role }]. Read live
// from the actual assignments, so filling/removing a leader updates it at once.
export async function loadResponsibleHolders() {
  // The assignment table + the designation `level` column must exist before we can
  // read holders (this runs before fetchIncompleteDesignation, which also ensures
  // them). Idempotent + cached, so it's a no-op once created.
  await ensureContactDesignationsSchema();
  await ensureDesignationLevelColumn(query);
  const holders = { state: new Map(), lok_sabha: new Map(), district: new Map(), assembly: new Map() };
  // The set of designation phrases we care about, by respLevel.
  const wanted = {};
  for (const lvl of TEAM_LEVELS) {
    const { respLevel, names } = RESPONSIBILITY[lvl];
    wanted[respLevel] = wanted[respLevel] || new Set();
    for (const n of names) wanted[respLevel].add(n);
  }

  for (const respLevel of Object.keys(wanted)) {
    const phrases = [...wanted[respLevel]];
    let rows;
    if (respLevel === "state") {
      rows = await query(
        `SELECT 0 AS loc_id, c.id AS contact_id, c.person_name, c.phone_number, LOWER(d.name) AS dname
           FROM contacts c
           JOIN contact_designations cd ON cd.contact_id = c.id
           JOIN designations d ON d.id = cd.designation_id AND d.level = 'state'`
      );
    } else {
      rows = await query(
        `SELECT ${RESP_LOC_EXPR[respLevel]} AS loc_id, c.id AS contact_id, c.person_name, c.phone_number, LOWER(d.name) AS dname
           FROM contacts c
           JOIN contact_designations cd ON cd.contact_id = c.id
           JOIN designations d ON d.id = cd.designation_id AND d.level = ?
           LEFT JOIN locations ld ON ld.id = c.district_id
           LEFT JOIN locations lls ON lls.id = ld.parent_id`,
        [respLevel]
      );
    }
    const byLoc = holders[respLevel];
    for (const r of rows) {
      // Match the designation name to one of the wanted phrases (substring-tolerant).
      const matched = phrases.find((p) => String(r.dname || "").includes(p));
      if (!matched) continue;
      const loc = r.loc_id ?? 0;
      if (!byLoc.has(loc)) byLoc.set(loc, []);
      byLoc.get(loc).push({
        contact_id: r.contact_id,
        person_name: r.person_name,
        mobile: r.phone_number || null,
        role: titleCase(matched),
      });
    }
  }
  return holders;
}

function titleCase(s) {
  return String(s || "").replace(/\b\w/g, (m) => m.toUpperCase());
}

// Resolve the responsible person(s) for a vacancy at (level, locationId).
// Returns an array; empty means "Responsible Person Not Assigned". Each entry:
//   { contact_id, person_name, mobile, role }
export function resolveResponsible(level, locationId, index, holders) {
  const cfg = RESPONSIBILITY[level];
  if (!cfg) return [];
  if (cfg.respLevel === "state") {
    // State Working President — a single state-wide holder (location 0).
    return dedupe(holders.state.get(0) || []);
  }
  // The responsible area is the parent location of the vacancy's own location.
  const self = index.get(locationId);
  const parentId = self?.parent_id ?? null;
  if (parentId == null) return [];
  return dedupe((holders[cfg.respLevel].get(parentId) || []));
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const h of list) {
    if (seen.has(h.contact_id)) continue;
    seen.add(h.contact_id);
    out.push(h);
  }
  return out;
}
