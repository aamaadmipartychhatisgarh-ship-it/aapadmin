// PROMPT 13 — a Designation is associated with a single hierarchy LEVEL, so the
// Designation Hierarchy page (State / Zone / Lok Sabha / District / Assembly /
// Block) can show each location's own level-appropriate designations.
//
// Canonical level keys match the geographic-level keys used by the hierarchy
// API (contacts/hierarchy) and the location master `type` values, except
// "block" maps to the location master's `ward` type. Keeping the SAME keys here
// means a designation's `level` lines up 1:1 with the hierarchy level selector.
export const DESIGNATION_LEVELS = [
  { key: "state", label: "State" },
  { key: "zone", label: "Zone" },
  { key: "lok_sabha", label: "Lok Sabha" },
  { key: "district", label: "District" },
  { key: "assembly", label: "Assembly" },
  { key: "block", label: "Block" },
];

export const DESIGNATION_LEVEL_KEYS = DESIGNATION_LEVELS.map((l) => l.key);

const LABEL_BY_KEY = new Map(DESIGNATION_LEVELS.map((l) => [l.key, l.label]));

export function isValidDesignationLevel(key) {
  return LABEL_BY_KEY.has(key);
}

export function designationLevelLabel(key) {
  return LABEL_BY_KEY.get(key) || null;
}

// Lazily add the nullable `level` column to the designations table (idempotent).
// Existing rows keep level = NULL until an admin assigns one; nothing breaks.
let ensured = false;
export async function ensureDesignationLevelColumn(query) {
  if (ensured) return;
  const cols = await query("SHOW COLUMNS FROM designations LIKE 'level'");
  if (cols.length === 0) {
    await query("ALTER TABLE designations ADD COLUMN level VARCHAR(32) NULL AFTER name");
  }
  ensured = true;
}
