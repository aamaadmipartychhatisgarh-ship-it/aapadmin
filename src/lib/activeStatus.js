// The ONE canonical set of Active Status values + display labels. Shared by the
// Active Worker page (where an authorized user manages a worker's status), the
// Log Outcome read-only display, and the API validation — a single source of
// truth so there are never alternative spellings or duplicate values.
//
// Stored value (on users.active_status) ↔ the exact four UI labels:
export const ACTIVE_STATUS_OPTIONS = [
  { value: "VERY_ACTIVE", label: "Very Active" },
  { value: "ACTIVE", label: "Active" },
  { value: "AVERAGE", label: "Average" },
  { value: "NOT_ACTIVE", label: "Not Active" },
];

export const ACTIVE_STATUS_VALUES = ACTIVE_STATUS_OPTIONS.map((o) => o.value);
export const ACTIVE_STATUS_LABEL = Object.fromEntries(ACTIVE_STATUS_OPTIONS.map((o) => [o.value, o.label]));

// Normalize an incoming value to its canonical form, or null if not one of the
// four allowed values (used for server-side validation).
export function normalizeActiveStatus(v) {
  const s = String(v || "").trim().toUpperCase();
  return ACTIVE_STATUS_VALUES.includes(s) ? s : null;
}
