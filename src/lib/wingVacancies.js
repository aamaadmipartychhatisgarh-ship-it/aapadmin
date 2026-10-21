import { query } from "@/lib/db";
import { fetchIncompleteDesignation } from "@/lib/incompleteDesignations";
import { ensureWingSchema, listWings } from "@/lib/wingDesignations";
import { wingsMapFor } from "@/lib/designationWings";
import { ensureContactWingsSchema } from "@/lib/contactWings";
import { loadLocationIndex, ancestryOf } from "@/lib/vacancyResponsibility";

// WING DESIGNATION VACANCIES — the Designation Vacancies check applied to each
// organizational Wing (Wing master `wings`, excluding Main Organisation, which the
// main vacancy dashboard already covers).
//
// For every enabled Wing × level (State → Lok Sabha → District → Assembly) ×
// location, three positions are required: President, Prabhari, General Secretary.
//
//   • The Wing's designation for a role is read from the Designation Master — the
//     generated "<Level> <Role>, <Wing>" rows (designations.wing / wing_base_id →
//     wing_designations.base_name) and any multi-wing designation (designation_wings).
//     Nothing is invented: a role the Wing master does not define is reported as
//     NOT CONFIGURED (a data check), never as a vacancy.
//   • Source of truth = the saved Contact records: Wings (contact_wings),
//     Designations (contact_designations), Lok Sabha / District / Assembly
//     (contacts.*_id). No vacancy list is stored; everything is derived live.
//   • Filled / vacant comes from the SAME engine as the main dashboard
//     (fetchIncompleteDesignation): real Contacts holding that designation at that
//     exact location; wrong-number / unapproved contacts excluded; a holder with a
//     missing/invalid location makes the position NEEDS REVIEW, never vacant.
//   • A designation shared by several Wings is filled for a Wing only by a holder
//     whose saved Contact Wings include it (no saved Wing → the designation's own
//     Wings). A holder whose saved Wings match none of the designation's Wings is a
//     Wing mapping problem → NEEDS REVIEW + listed in the data check.
//   • A holder whose saved Lok Sabha / District contradicts the master parent of
//     their saved District / Assembly (a half-done mapping change) fills nothing:
//     NEEDS REVIEW + data check.
//   • Nothing is cached or stored, so any Contact edit (Wing, Designation, Lok
//     Sabha, District, Assembly) is reflected — old and new places alike — on the
//     next read.
//   • One entry per (Wing, level, location, role) — never duplicated.
//   • Responsible person of a vacancy: the same Wing's same role one level up, in
//     the vacancy's parent area (President → upper President, Prabhari → upper
//     Prabhari, General Secretary → upper General Secretary). State has none.
// Any failed query propagates (the API returns an error, no vacancies shown).

export const WING_VACANCY_LEVELS = ["state", "lok_sabha", "district", "assembly"];
const LEVEL_LABEL = { state: "State", lok_sabha: "Lok Sabha", district: "District", assembly: "Assembly" };
export const WING_ROLES = [
  { key: "president", label: "President" },
  { key: "prabhari", label: "Prabhari" },
  { key: "general_secretary", label: "General Secretary" },
];
const ROLE_LABEL = Object.fromEntries(WING_ROLES.map((r) => [r.key, r.label]));
const ROLE_NAMES = {
  president: ["president", "adhyaksh", "adhyaksha", "अध्यक्ष"],
  prabhari: ["prabhari", "प्रभारी"],
  general_secretary: ["general secretary", "gen secretary", "mahasachiv", "maha sachiv", "महासचिव", "महा सचिव"],
};
const LEVEL_WORDS = /\b(state|pradesh|lok ?sabha|district|zila|jila|assembly|vidhan ?sabha|vidhansabha|block)\b|प्रदेश|लोकसभा|लोक सभा|जिला|ज़िला|विधानसभा|विधान सभा/g;
const MAX_ROWS = 2000;

const norm = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();

// The Wing role (president | prabhari | general_secretary) of a designation, or
// null. Uses the Wing master base role when the designation was generated from
// one; otherwise its name with the ", <Wing>" suffix and level words removed. The
// remainder must be EXACTLY the role ("Vice President", "Secretary",
// "General Secretary Media" are not these positions).
export function wingRoleOf(baseName, designationName, wingNames = []) {
  let s = baseName ? String(baseName) : String(designationName || "");
  if (!baseName) {
    // Drop the Wing's own name wherever it appears ("…, Mahila Wing", "Mahila Wing …").
    for (const w of wingNames) {
      s = s.replace(new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}])`, "giu"), "$1 ");
    }
  }
  const rest = s.toLowerCase().replace(/[\/,.\-()&]+/g, " ").replace(LEVEL_WORDS, " ").replace(/\bwings?\b/g, " ").replace(/\s+/g, " ").trim();
  for (const [k, names] of Object.entries(ROLE_NAMES)) if (names.includes(rest)) return k;
  return null;
}

const PARENT_LEVEL = { lok_sabha: "state", district: "lok_sabha", assembly: "district" };

// { label, level_label, area, status, people, note } for a vacant position:
//   status "assigned"       — people = the upper-level holder(s) (name + held designation)
//   status "not_assigned"   — the upper position exists but nobody holds it
//   status "review"         — the upper position's holder has a mapping problem
//   status "not_configured" — the Wing master has no such role at the upper level
//   status "no_parent_area" — the vacancy's parent area is missing in the master
//   status "top_level"      — State: there is no upper Wing level
function responsibleFor(p, positions) {
  const parent = PARENT_LEVEL[p.level];
  if (!parent) return { status: "top_level", label: null, people: [], note: "State level — no upper Wing level" };
  const label = `${LEVEL_LABEL[parent]} ${ROLE_LABEL[p.role]}, ${p.wing}`;
  const areaId = parent === "state" ? 0 : parent === "lok_sabha" ? p.lok_sabha_id : p.district_id;
  const areaName = parent === "state" ? "State" : parent === "lok_sabha" ? p.lok_sabha_name : p.district_name;
  if (areaId == null) return { status: "no_parent_area", label, level_label: LEVEL_LABEL[parent], area: null, people: [], note: `${LEVEL_LABEL[parent]} area missing in the location master` };
  const up = positions.get(`${p.wing}|${parent}|${areaId}|${p.role}`);
  if (!up) return { status: "not_configured", label, level_label: LEVEL_LABEL[parent], area: areaName, people: [], note: `${label} is not configured in the Wing master` };
  if (up.holders.length) {
    return { status: "assigned", label: up.designations.map((d) => d.name).join(" / ") || label, level_label: LEVEL_LABEL[parent], area: areaName,
      people: up.holders.map((h) => ({ contact_id: h.contact_id, name: h.name, designation: h.designation, mobile: h.mobile || null })), note: null };
  }
  if (up.review_people.length) return { status: "review", label, level_label: LEVEL_LABEL[parent], area: areaName, people: [], note: `${label} (${areaName}) needs review — holder's location or Wing is incomplete` };
  return { status: "not_assigned", label, level_label: LEVEL_LABEL[parent], area: areaName, people: [], note: `${label} (${areaName}) — Not assigned` };
}

// A holder's saved Lok Sabha / District that contradicts where the position's
// location actually sits in the location master, or null when consistent (an
// unset higher-level field is not a conflict).
function conflictReason(level, info, anc) {
  if (level === "assembly" && info.district_id != null && anc.district_id != null && Number(info.district_id) !== anc.district_id) {
    return `Saved District (${info.district_name || `id ${info.district_id}`}) does not contain the saved Assembly (${anc.assembly_name})`;
  }
  if ((level === "assembly" || level === "district") && info.lok_sabha_id != null && anc.lok_sabha_id != null && Number(info.lok_sabha_id) !== anc.lok_sabha_id) {
    return `Saved Lok Sabha (${info.lok_sabha_name || `id ${info.lok_sabha_id}`}) does not contain the saved ${LEVEL_LABEL[level]} (${level === "assembly" ? anc.assembly_name : anc.district_name})`;
  }
  return null;
}

const asId = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };

// Designation ids that ARE Wing positions — President / Prabhari / General
// Secretary of an enabled Wing at State → Assembly. The Wings view owns them (with
// the Wing responsibility hierarchy); the Main Organisation view skips them so the
// same post is never shown twice with two different responsible people.
export async function wingPositionDesignationIds() {
  await ensureWingSchema();
  const enabled = new Set((await listWings())
    .filter((w) => Number(w.is_main) !== 1 && (w.enabled == null || Number(w.enabled) === 1))
    .map((w) => norm(w.name)));
  const rows = await query(
    `SELECT d.id, d.name, d.wing, wd.base_name FROM designations d
       LEFT JOIN wing_designations wd ON wd.id = d.wing_base_id
      WHERE d.level IN (${WING_VACANCY_LEVELS.map(() => "?").join(",")})`,
    WING_VACANCY_LEVELS
  );
  const wings = await wingsMapFor(rows);
  const ids = new Set();
  for (const r of rows) {
    const ws = (wings.get(r.id) || []).filter((w) => enabled.has(norm(w)));
    if (ws.length && wingRoleOf(r.base_name, r.name, ws)) ids.add(r.id);
  }
  return ids;
}

export async function buildWingVacancyDataset(session, filters = {}) {
  const f = {
    wing: String(filters.wing || "").trim() || null,
    level: WING_VACANCY_LEVELS.includes(filters.level) ? filters.level : null,
    role: WING_ROLES.some((r) => r.key === filters.role) ? filters.role : null,
    lokSabhaId: asId(filters.lokSabhaId),
    districtId: asId(filters.districtId),
    assemblyId: asId(filters.assemblyId),
    // "any" = every position whatever its status, uncapped (used by the Main tab's
    // Wing filter to merge this Wing's positions into its own list).
    status: ["filled", "vacant", "review", "any"].includes(filters.status) ? filters.status : "all",
  };

  await ensureWingSchema();
  await ensureContactWingsSchema();
  // Wing master: enabled, non-main wings, de-duplicated by name (first = master order).
  const allWings = await listWings();
  const wings = [];
  const seenWing = new Set();
  for (const w of allWings) {
    if (Number(w.is_main) === 1 || (w.enabled != null && Number(w.enabled) !== 1)) continue;
    const k = norm(w.name);
    if (!k || seenWing.has(k)) continue;
    seenWing.add(k);
    wings.push(w.name);
  }
  const knownWings = new Set(allWings.map((w) => norm(w.name)));
  const wingByNorm = new Map(wings.map((w) => [norm(w), w]));

  // Base roles of generated designations (wing_base_id → wing_designations.base_name).
  const baseRows = await query(
    `SELECT d.id, wd.base_name FROM designations d JOIN wing_designations wd ON wd.id = d.wing_base_id WHERE d.wing_base_id IS NOT NULL`
  );
  const baseOf = new Map(baseRows.map((r) => [r.id, r.base_name]));

  const index = await loadLocationIndex();
  const positions = new Map(); // key → position
  const configured = new Set(); // wing|level|role with ≥1 designation
  const unknownWingDesignations = [];
  const wingMismatch = [];
  const hierarchyConflicts = [];
  const unmapped = [];

  // Every level is always scanned (even with a level filter): a vacancy's
  // responsible person sits one level up.
  for (const level of WING_VACANCY_LEVELS) {
    // eslint-disable-next-line no-await-in-loop
    const data = await fetchIncompleteDesignation(session, { level, status: "all" });
    // A truncated holder list would turn filled positions into false vacancies.
    if (data.capped) throw new Error(`Too many ${LEVEL_LABEL[level]} designation holders to compute wing vacancies safely`);

    // The Wing designations of this level that are one of the three roles.
    const roleOfDes = new Map(); // designation id → role
    for (const d of data.level_designations) {
      const dw = (d.wings || []).filter(Boolean);
      if (!dw.length) continue;
      const role = wingRoleOf(baseOf.get(d.id), d.name, dw);
      if (!role) continue;
      for (const w of dw) {
        if (!knownWings.has(norm(w))) unknownWingDesignations.push({ designation_id: d.id, designation_name: d.name, level, level_label: LEVEL_LABEL[level], wing: w });
        const wing = wingByNorm.get(norm(w));
        if (wing) configured.add(`${wing}|${level}|${role}`);
      }
      roleOfDes.set(d.id, role);
    }
    if (!roleOfDes.size) continue;

    // Saved Contact Wings of every holder of those designations (one lookup per level).
    const holderIds = [...new Set(data.rows.filter((r) => roleOfDes.has(r.designation_id)).flatMap((r) => r.people.map((p) => p.id)))];
    const savedWings = new Map(); // contact id → normalized saved Wing names (matching)
    const savedLabels = new Map(); // contact id → saved Wing names as stored (display)
    for (let i = 0; i < holderIds.length; i += 1000) {
      const chunk = holderIds.slice(i, i + 1000);
      // eslint-disable-next-line no-await-in-loop
      const rows = await query(`SELECT contact_id, wing FROM contact_wings WHERE contact_id IN (${chunk.map(() => "?").join(",")})`, chunk);
      for (const r of rows) {
        if (!savedWings.has(r.contact_id)) { savedWings.set(r.contact_id, []); savedLabels.set(r.contact_id, []); }
        savedWings.get(r.contact_id).push(norm(r.wing));
        savedLabels.get(r.contact_id).push(r.wing);
      }
    }

    // The holders' saved Contact fields (Lok Sabha / District / Assembly as stored),
    // shown next to each holder so the match can be checked against the Contact List.
    const contactInfo = new Map();
    for (let i = 0; i < holderIds.length; i += 1000) {
      const chunk = holderIds.slice(i, i + 1000);
      // eslint-disable-next-line no-await-in-loop
      const rows = await query(
        `SELECT c.id, c.phone_number, c.lok_sabha_id, c.district_id, lls.name AS lok_sabha_name, ld.name AS district_name, la.name AS assembly_name
           FROM contacts c
           LEFT JOIN locations lls ON lls.id = c.lok_sabha_id
           LEFT JOIN locations ld ON ld.id = c.district_id
           LEFT JOIN locations la ON la.id = c.assembly_id
          WHERE c.id IN (${chunk.map(() => "?").join(",")})`,
        chunk
      );
      for (const r of rows) {
        contactInfo.set(r.id, {
          mobile: r.phone_number || null, lok_sabha_id: r.lok_sabha_id ?? null, district_id: r.district_id ?? null,
          lok_sabha_name: r.lok_sabha_name || null, district_name: r.district_name || null, assembly_name: r.assembly_name || null,
        });
      }
    }

    for (const r of data.rows) {
      const role = roleOfDes.get(r.designation_id);
      if (!role) continue;
      const desWings = (r.designation_wings || []).map((w) => wingByNorm.get(norm(w))).filter(Boolean);
      if (!desWings.length) continue;
      const desNorms = new Set(desWings.map(norm));
      const anc = ancestryOf(index, level, r.location_id);
      for (const wing of desWings) {
        const key = `${wing}|${level}|${r.location_id}|${role}`;
        if (!positions.has(key)) {
          positions.set(key, {
            wing, level, level_label: LEVEL_LABEL[level], role, role_label: ROLE_LABEL[role],
            location_id: r.location_id, location_name: r.location_name, ...anc,
            designations: [], holders: [], review_people: [],
          });
        }
        const pos = positions.get(key);
        if (!pos.designations.some((d) => d.id === r.designation_id)) pos.designations.push({ id: r.designation_id, name: r.designation_name });
        for (const p of r.people) {
          // Saved higher-level location that contradicts the position's own parent
          // (e.g. the District was changed but the Assembly was not) — the contact's
          // mapping is inconsistent, so it can't be trusted to fill either place.
          const info = contactInfo.get(p.id) || {};
          const conflict = conflictReason(level, info, anc);
          if (conflict) {
            if (!pos.review_people.some((x) => x.contact_id === p.id)) pos.review_people.push({ contact_id: p.id, person_name: p.person_name, reason: conflict });
            if (!hierarchyConflicts.some((x) => x.contact_id === p.id && x.designation_id === r.designation_id)) {
              hierarchyConflicts.push({ contact_id: p.id, person_name: p.person_name, designation_id: r.designation_id, designation_name: r.designation_name, level_label: LEVEL_LABEL[level], location_name: r.location_name, reason: conflict });
            }
            continue;
          }
          const saved = savedWings.get(p.id) || [];
          const eff = saved.length ? saved : [...desNorms];
          if (eff.includes(norm(wing))) {
            if (!pos.holders.some((h) => h.contact_id === p.id)) {
              pos.holders.push({
                contact_id: p.id, name: p.person_name, designation: r.designation_name,
                wings: savedLabels.get(p.id) || [], ...(contactInfo.get(p.id) || {}),
              });
            }
          } else if (!eff.some((w) => desNorms.has(w))) {
            // Saved Wings match NONE of the designation's Wings — a mapping problem.
            const shown = savedLabels.get(p.id) || [];
            const reason = `Holds "${r.designation_name}" but the contact's saved Wings are: ${shown.join(", ") || "—"}`;
            if (!pos.review_people.some((x) => x.contact_id === p.id)) pos.review_people.push({ contact_id: p.id, person_name: p.person_name, reason });
            if (!wingMismatch.some((x) => x.contact_id === p.id && x.designation_id === r.designation_id)) {
              wingMismatch.push({ contact_id: p.id, person_name: p.person_name, designation_id: r.designation_id, designation_name: r.designation_name, level_label: LEVEL_LABEL[level], location_name: r.location_name, saved_wings: shown });
            }
          }
        }
        if (r.status === "review") {
          for (const rp of r.review_people || []) if (!pos.review_people.some((x) => x.contact_id === rp.contact_id)) pos.review_people.push(rp);
        }
      }
    }
    for (const u of data.unmapped_holders || []) if (roleOfDes.has(u.designation_id)) unmapped.push({ ...u, level_label: LEVEL_LABEL[level] });
  }

  // Status per position.
  let all = [...positions.values()].map((p) => ({
    ...p,
    designation_name: p.designations.map((d) => d.name).join(" / "),
    status: p.holders.length ? "filled" : p.review_people.length ? "review" : "vacant",
  }));

  // "Mahila Wing → Assembly XYZ → President → VACANT"
  for (const p of all) {
    p.path = `${p.wing} → ${p.level === "state" ? "State" : `${p.level_label} ${p.location_name}`} → ${p.role_label} → ${p.status === "vacant" ? "VACANT" : p.status === "filled" ? "FILLED" : "NEEDS REVIEW"}`;
  }

  // Responsible person of each VACANT position: the holder(s) of the SAME role in
  // the SAME Wing at the immediately upper level, in the vacancy's own parent area
  // (Lok Sabha → State; District → its Lok Sabha; Assembly → its District).
  // Holders are the position's matched holders above, so a person from another
  // Wing, another role or another area can never be picked.
  for (const p of all) {
    if (p.status !== "vacant") continue;
    p.responsible = responsibleFor(p, positions);
  }

  // Wing roles the Wing master does not define at a level — data check, not vacancies.
  const notConfigured = [];
  for (const wing of wings) {
    for (const level of WING_VACANCY_LEVELS) {
      if (f.level && f.level !== level) continue;
      for (const r of WING_ROLES) {
        if (!configured.has(`${wing}|${level}|${r.key}`)) notConfigured.push({ wing, level, level_label: LEVEL_LABEL[level], role: r.key, role_label: r.label });
      }
    }
  }

  // Filters (cards + table share the scope; status narrows the table only).
  const scoped = all.filter((p) => {
    if (f.level && p.level !== f.level) return false;
    if (f.wing && norm(p.wing) !== norm(f.wing)) return false;
    if (f.role && p.role !== f.role) return false;
    if (f.lokSabhaId && p.lok_sabha_id !== f.lokSabhaId) return false;
    if (f.districtId && p.district_id !== f.districtId) return false;
    if (f.assemblyId && p.assembly_id !== f.assemblyId) return false;
    return true;
  });
  const wingOrder = new Map(wings.map((w, i) => [w, i]));
  const levelOrder = new Map(WING_VACANCY_LEVELS.map((l, i) => [l, i]));
  const roleOrder = new Map(WING_ROLES.map((r, i) => [r.key, i]));
  scoped.sort((a, b) => (wingOrder.get(a.wing) - wingOrder.get(b.wing))
    || (levelOrder.get(a.level) - levelOrder.get(b.level))
    || String(a.location_name).localeCompare(String(b.location_name))
    || (roleOrder.get(a.role) - roleOrder.get(b.role)));

  let rows = f.status === "any" ? scoped
    : f.status === "all" ? scoped.filter((p) => p.status !== "filled") : scoped.filter((p) => p.status === f.status);
  const capped = f.status !== "any" && rows.length > MAX_ROWS;
  if (f.status !== "any") rows = rows.slice(0, MAX_ROWS);

  // Per-Wing summary (scope applied).
  const byWing = new Map();
  for (const p of scoped) {
    if (!byWing.has(p.wing)) byWing.set(p.wing, { wing: p.wing, total: 0, filled: 0, vacant: 0, review: 0 });
    const s = byWing.get(p.wing);
    s.total++; s[p.status]++;
  }

  const locByType = { lok_sabha: [], district: [], assembly: [] };
  for (const loc of index.values()) if (locByType[loc.type]) locByType[loc.type].push({ id: loc.id, name: loc.name, parent_id: loc.parent_id });
  for (const k of Object.keys(locByType)) locByType[k].sort((a, b) => String(a.name).localeCompare(String(b.name)));

  // Assignments whose designation no longer exists in the master (e.g. left behind
  // by an old merge/delete) can't fill any position — surfaced, never guessed.
  const orphanAssignments = await query(
    `SELECT cd.contact_id, c.person_name, cd.designation_id
       FROM contact_designations cd
       JOIN contacts c ON c.id = cd.contact_id
       LEFT JOIN designations d ON d.id = cd.designation_id
      WHERE d.id IS NULL
      ORDER BY c.person_name
      LIMIT 200`
  );

  const nc = notConfigured.filter((n) => (!f.wing || norm(n.wing) === norm(f.wing)) && (!f.role || n.role === f.role));
  return {
    counts: {
      total: scoped.length,
      filled: scoped.filter((p) => p.status === "filled").length,
      vacant: scoped.filter((p) => p.status === "vacant").length,
      review: scoped.filter((p) => p.status === "review").length,
      not_configured: nc.length,
    },
    vacancies: rows,
    capped,
    by_wing: [...byWing.values()].sort((a, b) => wingOrder.get(a.wing) - wingOrder.get(b.wing)),
    data_quality: {
      not_configured: nc,
      unknown_wing_designations: unknownWingDesignations,
      wing_mismatch: wingMismatch.filter((m) => !f.wing || scoped.some((p) => norm(p.wing) === norm(f.wing) && p.designations.some((d) => d.id === m.designation_id))),
      unmapped_holders: unmapped,
      orphan_assignments: orphanAssignments,
      hierarchy_conflicts: hierarchyConflicts,
    },
    filters: {
      wings,
      levels: WING_VACANCY_LEVELS.map((k) => ({ key: k, label: LEVEL_LABEL[k] })),
      roles: WING_ROLES,
      locations: locByType,
    },
  };
}
