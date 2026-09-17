// Single source of truth for date display across the app. Always DD-MM-YYYY in
// the application timezone (Asia/Kolkata). Never YYYY-MM-DD, never MM/DD/YYYY,
// never mixed/locale-dependent formats.
// Accepts a Date, an ISO string, or a "YYYY-MM-DD" date string.
// en-GB gives a day-first 2-digit numeric date; we render it with DASH
// separators (DD-MM-YYYY) rather than the locale's slashes.
const DMY = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric" });
const TIME = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true });

// "17/09/2026" → "17-09-2026". Only the date separators are slashes, so a plain
// replace is exact and safe.
const dash = (s) => s.replace(/\//g, "-");

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const s = String(value);
  // Plain YYYY-MM-DD → treat as a calendar date (avoid TZ shifting the day).
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 6, 30)); // noon-ish IST, stable day
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// "31-07-2026" (or "" when empty/invalid).
export function formatDate(value) {
  const d = toDate(value);
  return d ? dash(DMY.format(d)) : "";
}

// "31-07-2026, 05:15 PM"
export function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return "";
  return `${dash(DMY.format(d))}, ${TIME.format(d)}`;
}

// "31-07-2026 • 05:15 PM"
export function formatDateTimeDot(value) {
  const d = toDate(value);
  if (!d) return "";
  return `${dash(DMY.format(d))} • ${TIME.format(d)}`;
}
