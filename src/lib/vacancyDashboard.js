import { fetchIncompleteDesignation } from "@/lib/incompleteDesignations";
import {
  TEAM_LEVELS, loadLocationIndex, loadResponsibleHolders,
  ancestryOf, resolveResponsible,
} from "@/lib/vacancyResponsibility";
import { getReminderStates } from "@/lib/vacancyReminders";
import { query } from "@/lib/db";

const LEVEL_LABEL = { state: "State", lok_sabha: "Lok Sabha", district: "District", assembly: "Assembly", block: "Block" };
// Levels scanned for vacancies (State vacancies are the State Prabhari's).
const VACANCY_LEVELS = ["state", ...TEAM_LEVELS];
const MAX_ROWS = 2000;

const asId = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };

// The reminder group for a responsible person: all their vacancies share it, so
// one WhatsApp message covers them all.
export function groupKeyFor(contactId) {
  return `resp:${contactId}`;
}

// Build the complete vacancy dashboard dataset — computed LIVE from the
// organizational data every call (a filled designation simply stops appearing).
// Access control: fetchIncompleteDesignation already applies the caller's
// territory scope, so a non-super user only ever sees their own areas.
export async function buildVacancyDataset(session, filters = {}) {
  const f = {
    level: VACANCY_LEVELS.includes(filters.level) ? filters.level : null,
    lokSabhaId: asId(filters.lokSabhaId),
    districtId: asId(filters.districtId),
    assemblyId: asId(filters.assemblyId),
    blockId: asId(filters.blockId),
    designationId: asId(filters.designationId),
    // Wing filter: a set of stored wing names (from Master Data / the wing dropdown).
    wings: Array.isArray(filters.wings)
      ? filters.wings.map((w) => String(w || "").trim()).filter(Boolean)
      : String(filters.wings || "").split(",").map((w) => w.trim()).filter(Boolean),
    status: ["filled", "vacant", "review"].includes(filters.status) ? filters.status : "all",
    reminderStatus: ["sent", "pending", "failed"].includes(filters.reminderStatus) ? filters.reminderStatus : "all",
    responsibleId: asId(filters.responsibleId),
  };

  const index = await loadLocationIndex();
  const holders = await loadResponsibleHolders();

  const levels = f.level ? [f.level] : VACANCY_LEVELS;

  // 1) Pull every (location × designation) row for each scanned level, tagged with
  //    ancestry, and keep the level-designation lists for the filter dropdowns.
  const allRows = [];
  const designationOptions = [];
  const seenDes = new Set();
  const unmappedHolders = [];
  for (const level of levels) {
    // eslint-disable-next-line no-await-in-loop
    const data = await fetchIncompleteDesignation(session, { level, status: "all" });
    // A truncated holder list would turn filled positions into false vacancies —
    // fail closed instead of reporting them.
    if (data.capped) throw new Error(`Too many ${LEVEL_LABEL[level]} designation holders to compute vacancies safely`);
    for (const d of data.level_designations) {
      const k = `${level}:${d.id}`;
      if (!seenDes.has(k)) { seenDes.add(k); designationOptions.push({ id: d.id, name: d.name, wing: d.wing || null, wings: d.wings || [], level, level_label: LEVEL_LABEL[level] }); }
    }
    for (const u of data.unmapped_holders || []) unmappedHolders.push({ ...u, level, level_label: LEVEL_LABEL[level] });
    for (const r of data.rows) {
      const anc = ancestryOf(index, level, r.location_id);
      // A real location whose parent chain is broken in the master (e.g. an
      // assembly with no district) — still a position, flagged for the data check.
      const hierarchyIncomplete = (level === "assembly" && !anc.district_id) || (level === "district" && !anc.lok_sabha_id) || (level === "block" && !anc.assembly_id);
      allRows.push({
        level,
        level_label: LEVEL_LABEL[level],
        location_id: r.location_id,
        location_name: r.location_name,
        designation_id: r.designation_id,
        designation_name: r.designation_name,
        designation_wing: r.designation_wing || null,
        designation_wings: r.designation_wings || [],
        filled: r.filled,
        status: r.status || (r.filled ? "filled" : "vacant"),
        review_people: r.review_people || [],
        person_names: r.person_names,
        hierarchy_incomplete: hierarchyIncomplete,
        ...anc,
      });
    }
  }

  // 2) Apply the hierarchy + designation filters (shared by cards and table).
  const scoped = allRows.filter((r) => {
    if (f.lokSabhaId && r.lok_sabha_id !== f.lokSabhaId) return false;
    if (f.districtId && r.district_id !== f.districtId) return false;
    if (f.assemblyId && r.assembly_id !== f.assemblyId) return false;
    if (f.blockId && r.block_id !== f.blockId) return false;
    if (f.designationId && r.designation_id !== f.designationId) return false;
    if (f.wings.length && !(r.designation_wings || []).some((w) => f.wings.includes(w))) return false;
    return true;
  });

  const totalDesignations = scoped.length;
  const filledCount = scoped.filter((r) => r.status === "filled").length;
  const vacantCount = scoped.filter((r) => r.status === "vacant").length;
  const reviewCount = scoped.filter((r) => r.status === "review").length;

  // 3) ONE row per genuinely VACANT position (never duplicated per responsible
  //    person): the responsible people are listed on the row, each with their own
  //    reminder group. Who is responsible depends on the level AND on whether the
  //    vacant post is a Prabhari, a President or a Team post (vacancyResponsibility).
  const vacantRows = scoped.filter((r) => r.status === "vacant");
  const displayRows = [];
  const groupKeys = new Set();
  for (const r of vacantRows) {
    const res = resolveResponsible(r.level, r.location_id, r.designation_name, index, holders);
    const responsibles = res.people.map((rp) => {
      const gk = groupKeyFor(rp.contact_id);
      groupKeys.add(gk);
      return { contact_id: rp.contact_id, name: rp.person_name, role: rp.role, area: rp.area, mobile: rp.mobile, group_key: gk };
    });
    displayRows.push({
      ...r,
      responsibles,
      responsible_rule: res.rule,
      // Required roles nobody holds — shown as "Not assigned", never replaced.
      responsible_missing: res.missing,
      responsible_note: res.missing.length ? `Not assigned: ${res.missing.join(", ")}` : null,
    });
  }

  // 4) Attach reminder state per responsible (missing → pending default).
  const states = await getReminderStates([...groupKeys]);
  for (const row of displayRows) {
    for (const rp of row.responsibles) {
      const st = states.get(rp.group_key);
      rp.reminder_status = st?.status || "pending";
      rp.reminder_attempts = st?.attempts || 0;
      rp.last_reminder_at = st?.last_reminder_at || null;
    }
  }

  // 5) Reminder summary counts — over distinct responsible-person GROUPS.
  const groupStatus = new Map();
  for (const row of displayRows) {
    for (const rp of row.responsibles) {
      // A group's status is consistent (one record per group); take it once.
      if (!groupStatus.has(rp.group_key)) groupStatus.set(rp.group_key, rp.reminder_status);
    }
  }
  let remindersSent = 0, remindersPending = 0, remindersFailed = 0;
  for (const s of groupStatus.values()) {
    if (s === "sent") remindersSent++; else if (s === "failed") remindersFailed++; else remindersPending++;
  }

  // 6) Row-level filters (status + reminder + responsible) for the table only.
  let tableRows;
  if (f.status === "filled") {
    tableRows = scoped.filter((r) => r.status === "filled").map((r) => ({ ...r, responsibles: [], responsible_note: null }));
  } else if (f.status === "review") {
    tableRows = scoped.filter((r) => r.status === "review").map((r) => ({ ...r, responsibles: [], responsible_note: null }));
  } else {
    // Default list = genuine vacancies; "all" also lists the needs-review positions.
    tableRows = f.status === "vacant" ? displayRows
      : [...displayRows, ...scoped.filter((r) => r.status === "review").map((r) => ({ ...r, responsibles: [], responsible_note: null }))];
    if (f.reminderStatus !== "all") tableRows = tableRows.filter((r) => (r.responsibles || []).some((rp) => rp.reminder_status === f.reminderStatus));
    if (f.responsibleId) tableRows = tableRows.filter((r) => (r.responsibles || []).some((rp) => rp.contact_id === f.responsibleId));
  }
  const capped = tableRows.length > MAX_ROWS;
  tableRows = tableRows.slice(0, MAX_ROWS);

  // 7) Hierarchy drill-down: per (level × location) totals, for the current scope.
  const hierMap = new Map();
  for (const r of scoped) {
    const key = `${r.level}:${r.location_id}`;
    if (!hierMap.has(key)) {
      hierMap.set(key, {
        level: r.level, level_label: r.level_label, location_id: r.location_id, location_name: r.location_name,
        lok_sabha_name: r.lok_sabha_name, district_name: r.district_name, assembly_name: r.assembly_name, block_name: r.block_name,
        total: 0, filled: 0, vacant: 0, review: 0,
      });
    }
    const h = hierMap.get(key);
    h.total++; if (r.status === "filled") h.filled++; else if (r.status === "review") h.review = (h.review || 0) + 1; else h.vacant++;
  }
  const hierarchy = [...hierMap.values()].map((h) => ({ ...h, incomplete_pct: h.total ? Math.round((h.vacant / h.total) * 100) : 0 }))
    .sort((a, b) => b.vacant - a.vacant || a.location_name?.localeCompare(b.location_name || ""))
    .slice(0, 500);

  // 8) Responsible-person filter options (distinct, from the current vacancies).
  const respMap = new Map();
  for (const row of displayRows) {
    for (const rp of row.responsibles) {
      if (!respMap.has(rp.contact_id)) respMap.set(rp.contact_id, { contact_id: rp.contact_id, name: rp.name });
    }
  }

  // 9) Data quality — kept apart from vacancies so a mapping problem is never
  //    shown as a vacant position: holders with a missing/invalid location at
  //    their level, master designations with no valid level (no positions can be
  //    derived for them), and positions whose location chain is broken.
  const validLevels = ["state", "zone", ...TEAM_LEVELS];
  const hasEnabled = (await query("SHOW COLUMNS FROM designations LIKE 'enabled'")).length > 0;
  const noLevel = await query(
    `SELECT id, name, level FROM designations
      WHERE (level IS NULL OR TRIM(level) = '' OR level NOT IN (${validLevels.map(() => "?").join(",")}))
        ${hasEnabled ? "AND (enabled = 1 OR enabled IS NULL)" : ""}
      ORDER BY name`,
    validLevels
  );
  const scopedUnmapped = unmappedHolders.filter((u) => !f.designationId || u.designation_id === f.designationId);

  // Cascading location options (by type) for the filter dropdowns.
  const locByType = { lok_sabha: [], district: [], assembly: [], block: [] };
  const TYPE_TO_KEY = { lok_sabha: "lok_sabha", district: "district", assembly: "assembly", ward: "block" };
  for (const loc of index.values()) {
    const key = TYPE_TO_KEY[loc.type];
    if (key) locByType[key].push({ id: loc.id, name: loc.name, parent_id: loc.parent_id, sort_order: loc.sort_order });
  }
  // Lok Sabha follows its Master SEQUENCE (stored sort_order); the other types
  // keep alphabetical (their sort_order is always NULL, so name is the tiebreak).
  for (const k of Object.keys(locByType)) {
    locByType[k].sort((a, b) => {
      const ao = a.sort_order, bo = b.sort_order;
      if (ao != null && bo != null && ao !== bo) return ao - bo;
      if (ao != null && bo == null) return -1;
      if (ao == null && bo != null) return 1;
      return String(a.name).localeCompare(String(b.name));
    });
  }

  return {
    counts: {
      total: totalDesignations,
      filled: filledCount,
      vacant: vacantCount,
      review: reviewCount,
      incomplete_pct: totalDesignations ? Math.round((vacantCount / totalDesignations) * 100) : 0,
      reminders_sent: remindersSent,
      reminders_pending: remindersPending,
      reminders_failed: remindersFailed,
    },
    vacancies: tableRows,
    capped,
    hierarchy,
    data_quality: {
      unmapped_holders: scopedUnmapped,
      designations_without_level: noLevel,
      hierarchy_incomplete: scoped.filter((r) => r.hierarchy_incomplete).length,
    },
    filters: {
      // Keep the Designation Master order: options are already appended per level
      // (in level order) with designations in sort_order from incompleteDesignation
      // — re-sorting by name/level here would discard that authoritative order.
      designations: designationOptions,
      responsibles: [...respMap.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))),
      locations: locByType,
      levels: VACANCY_LEVELS.map((l) => ({ key: l, label: LEVEL_LABEL[l] })),
    },
  };
}

// Resolve one responsible person's CURRENT pending vacancies (used by the reminder
// endpoint to build the grouped message and validate the mobile). Recomputed live,
// so anything already filled is naturally excluded.
export async function pendingVacanciesForResponsible(session, contactId) {
  const data = await buildVacancyDataset(session, { responsibleId: contactId });
  const rows = data.vacancies.filter((r) => r.status === "vacant" && (r.responsibles || []).some((rp) => rp.contact_id === contactId));
  return rows.map((r) => ({ designation_name: r.designation_name, location_name: r.location_name, level_label: r.level_label }));
}
