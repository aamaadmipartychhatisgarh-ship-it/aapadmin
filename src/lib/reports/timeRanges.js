// Universal time-range presets for the Reports Engine.
//
// The DB session runs in UTC; all business dates are Asia/Kolkata (IST, +05:30).
// We compute calendar boundaries in IST here (in JS) and return plain
// 'YYYY-MM-DD' strings. The engine then filters with
//   DATE(CONVERT_TZ(<dateField>,'+00:00','+05:30')) BETWEEN ? AND ?
// so a row logged at 23:00 UTC (04:30 IST next day) lands on the correct IST day.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// "Now" shifted into IST, so getUTC* accessors read IST calendar parts.
function istNow() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

function ymd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Shift an IST date by whole days, staying on the IST clock.
function addDays(d, n) {
  return new Date(d.getTime() + n * 86400000);
}

// Monday=0 … Sunday=6 (ISO week starts Monday).
function isoDow(d) {
  return (d.getUTCDay() + 6) % 7;
}

export const TIME_PRESETS = [
  { key: "all", label: "All time" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last_7_days", label: "Last 7 days" },
  { key: "last_15_days", label: "Last 15 days" },
  { key: "last_30_days", label: "Last 30 days" },
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_quarter", label: "This quarter" },
  { key: "this_year", label: "This year" },
  { key: "custom", label: "Custom range" },
];

// Resolve a preset (+ optional custom from/to 'YYYY-MM-DD') to { from, to } in
// IST calendar days, or null for "no time filter".
export function resolveRange(preset, customFrom, customTo) {
  const now = istNow();
  const today = ymd(now);

  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = ymd(addDays(now, -1));
      return { from: y, to: y };
    }
    case "last_7_days":
      return { from: ymd(addDays(now, -6)), to: today };
    case "last_15_days":
      return { from: ymd(addDays(now, -14)), to: today };
    case "last_30_days":
      return { from: ymd(addDays(now, -29)), to: today };
    case "this_week": {
      const start = addDays(now, -isoDow(now));
      return { from: ymd(start), to: today };
    }
    case "last_week": {
      const thisWeekStart = addDays(now, -isoDow(now));
      const lastWeekStart = addDays(thisWeekStart, -7);
      const lastWeekEnd = addDays(thisWeekStart, -1);
      return { from: ymd(lastWeekStart), to: ymd(lastWeekEnd) };
    }
    case "this_month": {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { from: ymd(start), to: today };
    }
    case "last_month": {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)); // day 0 = last day of prev month
      return { from: ymd(start), to: ymd(end) };
    }
    case "this_quarter": {
      const q = Math.floor(now.getUTCMonth() / 3);
      const start = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
      return { from: ymd(start), to: today };
    }
    case "this_year": {
      const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      return { from: ymd(start), to: today };
    }
    case "custom": {
      if (!customFrom && !customTo) return null;
      return { from: customFrom || "2000-01-01", to: customTo || today };
    }
    case "all":
    default:
      return null;
  }
}
