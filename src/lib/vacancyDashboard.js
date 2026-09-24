import { fetchIncompleteDesignation } from "@/lib/incompleteDesignations";
import {
  TEAM_LEVELS, RESPONSIBILITY_LABEL, loadLocationIndex, loadResponsibleHolders,
  ancestryOf, resolveResponsible,
} from "@/lib/vacancyResponsibility";
import { getReminderStates } from "@/lib/vacancyReminders";

const LEVEL_LABEL = { lok_sabha: "Lok Sabha", district: "District", assembly: "Assembly", block: "Block" };
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
    level: TEAM_LEVELS.includes(filters.level) ? filters.level : null,
    lokSabhaId: asId(filters.lokSabhaId),
    districtId: asId(filters.districtId),
    assemblyId: asId(filters.assemblyId),
    blockId: asId(filters.blockId),
    designationId: asId(filters.designationId),
    status: ["filled", "vacant"].includes(filters.status) ? filters.status : "all",
    reminderStatus: ["sent", "pending", "failed"].includes(filters.reminderStatus) ? filters.reminderStatus : "all",
    responsibleId: asId(filters.responsibleId),
  };

  const index = await loadLocationIndex();
  const holders = await loadResponsibleHolders();

  const levels = f.level ? [f.level] : TEAM_LEVELS;

  // 1) Pull every (location × designation) row for each scanned level, tagged with
  //    ancestry, and keep the level-designation lists for the filter dropdowns.
  const allRows = [];
  const designationOptions = [];
  const seenDes = new Set();
  for (const level of levels) {
    // eslint-disable-next-line no-await-in-loop
    const data = await fetchIncompleteDesignation(session, { level, status: "all" });
    for (const d of data.level_designations) {
      const k = `${level}:${d.id}`;
      if (!seenDes.has(k)) { seenDes.add(k); designationOptions.push({ id: d.id, name: d.name, level, level_label: LEVEL_LABEL[level] }); }
    }
    for (const r of data.rows) {
      const anc = ancestryOf(index, level, r.location_id);
      allRows.push({
        level,
        level_label: LEVEL_LABEL[level],
        location_id: r.location_id,
        location_name: r.location_name,
        designation_id: r.designation_id,
        designation_name: r.designation_name,
        filled: r.filled,
        person_names: r.person_names,
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
    return true;
  });

  const totalDesignations = scoped.length;
  const filledCount = scoped.filter((r) => r.filled).length;
  const vacantCount = totalDesignations - filledCount;

  // 3) Expand each VACANT row into one display row per responsible person (or a
  //    single "Responsible Person Not Assigned" row), and collect reminder groups.
  const vacantRows = scoped.filter((r) => !r.filled);
  const displayRows = [];
  const groupKeys = new Set();
  for (const r of vacantRows) {
    const responsibles = resolveResponsible(r.level, r.location_id, index, holders);
    if (!responsibles.length) {
      displayRows.push({
        ...r,
        responsible_contact_id: null,
        responsible_name: "Responsible Person Not Assigned",
        responsible_role: RESPONSIBILITY_LABEL[r.level] || null,
        responsible_mobile: null,
        group_key: null,
      });
      continue;
    }
    for (const rp of responsibles) {
      const gk = groupKeyFor(rp.contact_id);
      groupKeys.add(gk);
      displayRows.push({
        ...r,
        responsible_contact_id: rp.contact_id,
        responsible_name: rp.person_name,
        responsible_role: rp.role || RESPONSIBILITY_LABEL[r.level] || null,
        responsible_mobile: rp.mobile,
        group_key: gk,
      });
    }
  }

  // 4) Attach reminder state per group (missing → pending default).
  const states = await getReminderStates([...groupKeys]);
  for (const row of displayRows) {
    const st = row.group_key ? states.get(row.group_key) : null;
    row.reminder_status = st?.status || (row.group_key ? "pending" : "none");
    row.reminder_attempts = st?.attempts || 0;
    row.last_reminder_at = st?.last_reminder_at || null;
  }

  // 5) Reminder summary counts — over distinct responsible-person GROUPS.
  const groupStatus = new Map();
  for (const row of displayRows) {
    if (!row.group_key) continue;
    // A group's status is consistent (one record per group); take it once.
    if (!groupStatus.has(row.group_key)) groupStatus.set(row.group_key, row.reminder_status);
  }
  let remindersSent = 0, remindersPending = 0, remindersFailed = 0;
  for (const s of groupStatus.values()) {
    if (s === "sent") remindersSent++; else if (s === "failed") remindersFailed++; else remindersPending++;
  }

  // 6) Row-level filters (status + reminder + responsible) for the table only.
  let tableRows;
  if (f.status === "filled") {
    tableRows = scoped.filter((r) => r.filled).map((r) => ({
      ...r, responsible_name: "—", responsible_role: null, responsible_mobile: null,
      group_key: null, reminder_status: "none", reminder_attempts: 0, last_reminder_at: null,
    }));
  } else {
    tableRows = displayRows;
    if (f.status === "vacant") { /* already vacant-only */ }
    if (f.reminderStatus !== "all") tableRows = tableRows.filter((r) => (r.reminder_status === f.reminderStatus) || (f.reminderStatus === "pending" && r.reminder_status === "none"));
    if (f.responsibleId) tableRows = tableRows.filter((r) => r.responsible_contact_id === f.responsibleId);
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
        total: 0, filled: 0, vacant: 0,
      });
    }
    const h = hierMap.get(key);
    h.total++; if (r.filled) h.filled++; else h.vacant++;
  }
  const hierarchy = [...hierMap.values()].map((h) => ({ ...h, incomplete_pct: h.total ? Math.round((h.vacant / h.total) * 100) : 0 }))
    .sort((a, b) => b.vacant - a.vacant || a.location_name?.localeCompare(b.location_name || ""))
    .slice(0, 500);

  // 8) Responsible-person filter options (distinct, from the current vacancies).
  const respMap = new Map();
  for (const row of displayRows) {
    if (row.responsible_contact_id && !respMap.has(row.responsible_contact_id)) {
      respMap.set(row.responsible_contact_id, { contact_id: row.responsible_contact_id, name: row.responsible_name });
    }
  }

  // Cascading location options (by type) for the filter dropdowns.
  const locByType = { lok_sabha: [], district: [], assembly: [], block: [] };
  const TYPE_TO_KEY = { lok_sabha: "lok_sabha", district: "district", assembly: "assembly", ward: "block" };
  for (const loc of index.values()) {
    const key = TYPE_TO_KEY[loc.type];
    if (key) locByType[key].push({ id: loc.id, name: loc.name, parent_id: loc.parent_id });
  }
  for (const k of Object.keys(locByType)) locByType[k].sort((a, b) => String(a.name).localeCompare(String(b.name)));

  return {
    counts: {
      total: totalDesignations,
      filled: filledCount,
      vacant: vacantCount,
      incomplete_pct: totalDesignations ? Math.round((vacantCount / totalDesignations) * 100) : 0,
      reminders_sent: remindersSent,
      reminders_pending: remindersPending,
      reminders_failed: remindersFailed,
    },
    vacancies: tableRows,
    capped,
    hierarchy,
    filters: {
      designations: designationOptions.sort((a, b) => a.level_label.localeCompare(b.level_label) || a.name.localeCompare(b.name)),
      responsibles: [...respMap.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))),
      locations: locByType,
      levels: TEAM_LEVELS.map((l) => ({ key: l, label: LEVEL_LABEL[l] })),
    },
  };
}

// Resolve one responsible person's CURRENT pending vacancies (used by the reminder
// endpoint to build the grouped message and validate the mobile). Recomputed live,
// so anything already filled is naturally excluded.
export async function pendingVacanciesForResponsible(session, contactId) {
  const data = await buildVacancyDataset(session, { responsibleId: contactId });
  const rows = data.vacancies.filter((r) => r.responsible_contact_id === contactId);
  return rows.map((r) => ({ designation_name: r.designation_name, location_name: r.location_name, level_label: r.level_label }));
}
