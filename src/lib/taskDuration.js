// Shared by the task form (client) and the tasks API (server) so "duration"
// always means the same thing in both places. Pure date math, no DB access —
// safe to import from either side.

export const DURATION_PRESETS = [
  { key: "one_day", label: "One Day", days: 1 },
  { key: "two_days", label: "Two Days", days: 2 },
  { key: "three_days", label: "Three Days", days: 3 },
  { key: "one_week", label: "One Week", days: 7 },
  { key: "two_weeks", label: "Two Weeks", days: 14 },
  { key: "one_month", label: "One Month", days: 30 },
  { key: "custom", label: "Custom", days: null },
];

export const DURATION_DAYS = Object.fromEntries(DURATION_PRESETS.map((p) => [p.key, p.days]));

// "2026-08-05" + 7 -> "2026-08-12". Calendar-day math via UTC midnight, so it's
// immune to local-timezone DST shifts.
export function addDays(dateStr, days) {
  if (!dateStr || !Number.isFinite(Number(days))) return null;
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

// Whole calendar days from `fromStr` to `toStr` (negative if `toStr` is earlier).
export function daysBetween(fromStr, toStr) {
  if (!fromStr || !toStr) return null;
  const a = new Date(`${fromStr.slice(0, 10)}T00:00:00Z`);
  const b = new Date(`${toStr.slice(0, 10)}T00:00:00Z`);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((b - a) / 86400000);
}
