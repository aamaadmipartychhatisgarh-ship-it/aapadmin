import { resolveRange } from "@/lib/reports/timeRanges";

// Shared date-range filter for the Media Center (newspaper coverage, debates,
// press conferences and their analytics), so every section applies the SAME
// selected range against the ACTUAL database date column — not just the rows on
// screen.
//
// Presets (today / yesterday / this_week / this_month / custom + a from/to
// range) resolve through the app's single IST-aware resolver (reports/
// timeRanges), so "today" means today in Asia/Kolkata everywhere — consistent
// with the rest of the app (Reports, dashboards).
//
// Media event dates (coverage_date, debate_date are DATE; conference_date is a
// DATETIME entered as an IST wall-clock value) are stored as local calendar
// values, so we compare against the IST day bounds DIRECTLY — no CONVERT_TZ.
// Half-open [from 00:00, (to+1) 00:00) keeps the column bare (index-friendly)
// and includes the entire "to" day. Returns { clause, params, range }; clause
// is "" for "all"/no selection so callers fall back to their default window.
export function mediaDateFilter(dateField, time, from, to) {
  const range = resolveRange(time, from, to);
  if (!range) return { clause: "", params: [], range: null };
  return {
    clause: ` AND ${dateField} >= ? AND ${dateField} < DATE_ADD(?, INTERVAL 1 DAY)`,
    params: [range.from, range.to],
    range,
  };
}
