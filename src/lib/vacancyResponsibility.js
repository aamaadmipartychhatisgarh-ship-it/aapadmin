import { query } from "@/lib/db";
import { ensureContactDesignationsSchema } from "@/lib/contactDesignations";
import { ensureDesignationLevelColumn } from "@/lib/designationLevels";
import { ensureLocationSortOrder } from "@/lib/locationOrder";
import { notWrongNumberClause, notPendingClause } from "@/lib/contactExtras";

// VACANCY RESPONSIBILITY — who must fill a vacant organizational designation.
//
// Derived AUTOMATICALLY from the real State → Lok Sabha → District → Assembly →
// Block hierarchy (locations.parent_id) and the actual Designation Master
// assignments (contact_designations). The rule depends on the vacancy's LEVEL and
// on the ROLE of the vacant designation (Prabhari, President, or a Team post):
//
//   Vacancy                     →  Responsible                                  at
//   -------------------------      -------------------------------------------  -----------------
//   State (any post)            →  State Prabhari                               State
//   Lok Sabha Prabhari          →  State President + State Working President    State
//   Lok Sabha President         →  State President + State Working President    State
//   Lok Sabha Team              →  Lok Sabha Prabhari + Lok Sabha President     same Lok Sabha
//   District Prabhari           →  Lok Sabha Prabhari                           parent Lok Sabha
//   District President          →  Lok Sabha President                          parent Lok Sabha
//   District Team               →  District Prabhari + District President       same District
//   Assembly Prabhari           →  District Prabhari                            parent District
//   Assembly President          →  District President                           parent District
//   Assembly Team               →  Assembly Prabhari + Assembly President       same Assembly
//   Block (Prabhari)            →  Assembly Prabhari                            parent Assembly
//   Block (President)           →  Assembly President                           parent Assembly
//   Block Team                  →  Assembly Prabhari + Assembly President       parent Assembly
//
// President and Prabhari lines are never mixed. Every responsible person is read
// from Contacts (their real name + the designation they actually hold). A required
// role nobody holds is reported as missing — never filled in with someone else.

// The location-master `type` for each vacancy team level (block = ward).
const LEVEL_TYPE = { lok_sabha: "lok_sabha", district: "district", assembly: "assembly", block: "ward" };
const LEVEL_LABEL = { state: "State", lok_sabha: "Lok Sabha", district: "District", assembly: "Assembly", block: "Block" };
const KIND_LABEL = { prabhari: "Prabhari", president: "President", working_president: "Working President" };

// ---- Role of a designation -------------------------------------------------------
// The designation's LEVEL comes from the Designation Master (`level` column); its
// name only says which leadership role it is. The level words and honorifics are
// stripped, and what remains must be EXACTLY the role — so "Vice President",
// "Sah Prabhari", "Mahila Wing President" or "Secretary" are Team posts.
const LEVEL_WORDS = /\b(state|pradesh|lok ?sabha|district|zila|jila|assembly|vidhan ?sabha|vidhansbha|vidhansbaha|block|ji)\b|प्रदेश|लोकसभा|लोक सभा|जिला|ज़िला|विधानसभा|विधान सभा|ब्लॉक|जी/g;
const ROLE_NAMES = {
  prabhari: ["prabhari", "प्रभारी"],
  president: ["president", "adhyaksh", "adhyaksha", "president adhyaksh", "अध्यक्ष"],
  working_president: ["working president", "karyakari adhyaksh", "karyakari adhyaksha", "karyakari president", "कार्यकारी अध्यक्ष"],
};

// "prabhari" | "president" | "working_president" | "team"
export function designationRole(name) {
  const rest = String(name || "").toLowerCase()
    .replace(/[\/,.\-()]+/g, " ")
    .replace(LEVEL_WORDS, " ")
    .replace(/\s+/g, " ").trim();
  for (const [kind, names] of Object.entries(ROLE_NAMES)) if (names.includes(rest)) return kind;
  return "team";
}

// ---- Rules ------------------------------------------------------------------------
// For a vacancy (level, role) → the responsible roles, each as [level, kind]. The
// responsible area is the vacancy location itself (same level) or its ancestor of
// that level; "state" is the single state-wide area.
const BOTH = (lvl) => [[lvl, "prabhari"], [lvl, "president"]];
const STATE_PRESIDENTS = [["state", "president"], ["state", "working_president"]];
const RULES = {
  state: { prabhari: [["state", "prabhari"]], president: [["state", "prabhari"]], team: [["state", "prabhari"]] },
  lok_sabha: { prabhari: STATE_PRESIDENTS, president: STATE_PRESIDENTS, team: BOTH("lok_sabha") },
  district: { prabhari: [["lok_sabha", "prabhari"]], president: [["lok_sabha", "president"]], team: BOTH("district") },
  assembly: { prabhari: [["district", "prabhari"]], president: [["district", "president"]], team: BOTH("assembly") },
  block: { prabhari: [["assembly", "prabhari"]], president: [["assembly", "president"]], team: BOTH("assembly") },
};

const roleLabel = ([lvl, kind]) => `${LEVEL_LABEL[lvl]} ${KIND_LABEL[kind]}`;

// The rule for one vacancy: { role, required: [[level, kind]...], label }.
export function responsibilityRule(level, designationName) {
  const levelRules = RULES[level];
  if (!levelRules) return { role: null, required: [], label: "—" };
  let role = designationRole(designationName);
  // A Working President is only a leadership role at State; elsewhere it is a team post.
  if (role === "working_president") role = level === "state" ? "president" : "team";
  const required = levelRules[role];
  return { role, required, label: required.map(roleLabel).join(" + ") };
}

// The levels scanned for vacancies that have a responsibility rule.
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

// Load every current holder of a leadership designation (Prabhari / President /
// Working President) at State, Lok Sabha, District and Assembly, bucketed by
// "level:kind" → locationId → [{ contact_id, person_name, mobile, role }]. `role`
// is the designation the person ACTUALLY holds (Designation Master name). Read
// live from the assignments, so filling/removing a leader updates it at once.
// Wrong-number / unapproved contacts are skipped, as they are for vacancies.
export async function loadResponsibleHolders() {
  // The assignment table + the designation `level` column must exist before we can
  // read holders (this runs before fetchIncompleteDesignation, which also ensures
  // them). Idempotent + cached, so it's a no-op once created.
  await ensureContactDesignationsSchema();
  await ensureDesignationLevelColumn(query);
  const live = (await notWrongNumberClause("c")) + (await notPendingClause("c"));
  const holders = new Map();
  for (const level of ["state", "lok_sabha", "district", "assembly"]) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await query(
      `SELECT ${level === "state" ? "0" : RESP_LOC_EXPR[level]} AS loc_id, c.id AS contact_id, c.person_name, c.phone_number, d.name AS dname
         FROM contacts c
         JOIN contact_designations cd ON cd.contact_id = c.id
         JOIN designations d ON d.id = cd.designation_id AND d.level = ?
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations lls ON lls.id = ld.parent_id
        WHERE 1=1 ${live}
        ORDER BY c.person_name`,
      [level]
    );
    for (const r of rows) {
      const kind = designationRole(r.dname);
      if (kind === "team" || r.loc_id == null) continue;
      const key = `${level}:${kind}`;
      if (!holders.has(key)) holders.set(key, new Map());
      const byLoc = holders.get(key);
      const loc = Number(r.loc_id);
      if (!byLoc.has(loc)) byLoc.set(loc, []);
      byLoc.get(loc).push({ contact_id: r.contact_id, person_name: r.person_name, mobile: r.phone_number || null, role: r.dname });
    }
  }
  return holders;
}

// Resolve the responsible person(s) for a vacancy of `designationName` at
// (level, locationId). Returns:
//   { people: [{ contact_id, person_name, mobile, role, area }], missing: [role labels], rule }
// `missing` lists each required role nobody holds in the responsible area (or whose
// area is missing from the hierarchy) — shown as "Not assigned", never guessed.
export function resolveResponsible(level, locationId, designationName, index, holders) {
  const rule = responsibilityRule(level, designationName);
  const people = [];
  const missing = [];
  const seen = new Set();
  for (const req of rule.required) {
    const [lvl, kind] = req;
    let area = null;
    if (lvl === "state") area = { id: 0, name: "State" };
    else {
      const a = ancestorOfType(index, locationId, LEVEL_TYPE[lvl]);
      if (a) area = { id: a.id, name: a.name };
    }
    const found = area ? (holders.get(`${lvl}:${kind}`)?.get(area.id) || []) : [];
    if (!found.length) { missing.push(roleLabel(req)); continue; }
    for (const h of found) {
      if (seen.has(h.contact_id)) continue;
      seen.add(h.contact_id);
      people.push({ ...h, area: area.name });
    }
  }
  return { people, missing, rule: rule.label };
}
