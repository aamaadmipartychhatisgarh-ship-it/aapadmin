// CONTACTS → Designation FILTER dropdown: every designation ONCE, Level-wise then Rank-wise.
//
// Order: State → Zone → Lok Sabha → District → Assembly (Vidhansabha) → Block → designations without a level (Member / Other),
// and inside a level by the designation's Rank (then sort order, then name) — the same Level + Rank the Incomplete Designation
// page uses.
//
// One entry per post: the generated Wing copies of a post ("Lok Sabha Prabhari, Mahila Wing", "…, Youth Wing" …) and the
// spelling variants of the same post at the same level ("Loksabha Prabhari" / "Lok Sabha Prabhari", "Sanghathan" /
// "Sangathan", a stray duplicate row) are ONE entry. The entry carries every underlying designation id, so picking it matches
// a contact holding any of them; the Wing filter (applied per assignment on the server) then narrows it to a Wing.
// Pure functions, no imports — safe on the client.

export const FILTER_LEVEL_ORDER = ["state", "zone", "lok_sabha", "district", "assembly", "block", ""];
export const FILTER_LEVEL_LABEL = {
  state: "State", zone: "Zone", lok_sabha: "Lok Sabha", district: "District", assembly: "Vidhansabha", block: "Block", "": "Member / Other",
};

const WING_SUFFIX = /,\s*[^,]*\bwing\s*$/i;
const LEVEL_PREFIX = /^(state|pradesh|zone|lok\s*sabha|loksabha|district|zila|jila|assembly|vidhan\s*sabha|vidhansabha|vidhansbha|block)\s+/i;

// The designation's level from the master; one saved without a level but NAMED with one ("Block President") goes to that
// level, so the same post never shows twice.
const LEVEL_FROM_NAME = [
  [/^(state|pradesh)\b/i, "state"], [/^zone\b/i, "zone"], [/^(lok\s*sabha|loksabha)\b/i, "lok_sabha"],
  [/^(district|zila|jila)\b/i, "district"], [/^(assembly|vidhan\s*sabha|vidhansabha|vidhansbha)\b/i, "assembly"], [/^block\b/i, "block"],
];
const levelOf = (d) => {
  const saved = String(d.level || "");
  if (saved && FILTER_LEVEL_ORDER.includes(saved)) return saved;
  const name = String(d.name || "").trim();
  return (LEVEL_FROM_NAME.find(([re]) => re.test(name)) || [null, ""])[1];
};
const hasWingSuffix = (name) => WING_SUFFIX.test(String(name || ""));
export const baseDesignationName = (name) => String(name || "").replace(WING_SUFFIX, "").replace(/\s+/g, " ").trim();

// The post a designation name stands for, within its level (level word, Wing suffix, spacing and known spelling variants removed).
export function designationPostKey(name) {
  const base = baseDesignationName(name).toLowerCase();
  const role = base.replace(LEVEL_PREFIX, "").trim() || base;
  return role.replace(/sang?h?a?than/g, "sangathan").replace(/[^a-z0-9ऀ-ॿ]+/g, "");
}

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const cmpNullLast = (a, b) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a - b);

// designations: the /api/designations list. Returns [{ id, name, ids, level, group }] in display order;
// `id` is a real designation id (the entry's representative), `ids` every designation id the entry covers.
export function groupDesignationsForFilter(designations = []) {
  const groups = new Map();
  for (const d of designations) {
    const level = levelOf(d);
    const key = `${level}|${designationPostKey(d.name) || `#${d.id}`}`;
    let g = groups.get(key);
    if (!g) { g = { level, members: [] }; groups.set(key, g); }
    g.members.push(d);
  }
  const out = [];
  for (const g of groups.values()) {
    const byRank = (a, b) => cmpNullLast(num(a.rank), num(b.rank)) || cmpNullLast(num(a.sort_order), num(b.sort_order)) || String(a.name).localeCompare(String(b.name));
    // The representative: the best-ranked designation named WITHOUT a Wing suffix (the Main / master name), else the best-ranked one.
    const sorted = [...g.members].sort(byRank);
    const rep = sorted.find((d) => !hasWingSuffix(d.name)) || sorted[0];
    out.push({
      id: rep.id,
      name: baseDesignationName(rep.name),
      ids: [...new Set(g.members.map((d) => d.id))],
      level: g.level,
      group: FILTER_LEVEL_LABEL[g.level],
      _rank: num(rep.rank), _sort: num(rep.sort_order),
    });
  }
  out.sort((a, b) => (FILTER_LEVEL_ORDER.indexOf(a.level) - FILTER_LEVEL_ORDER.indexOf(b.level))
    || cmpNullLast(a._rank, b._rank) || cmpNullLast(a._sort, b._sort) || a.name.localeCompare(b.name));
  return out.map(({ _rank, _sort, ...g }) => g);
}

// The designation ids to send for the picked entries (each entry → every id it covers; an unknown id is kept as is).
export function expandDesignationFilterIds(selected = [], groups = []) {
  const byId = new Map(groups.map((g) => [String(g.id), g]));
  return [...new Set(selected.flatMap((id) => byId.get(String(id))?.ids || [id]))];
}
