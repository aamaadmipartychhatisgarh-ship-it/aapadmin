import { runReport } from "./engine";
import { getModule } from "./registry";

// Build a multi-dimensional analytics payload for the analytical PDF:
//   - total records for the current filters
//   - breakdown tables for every meaningful dimension the module exposes
//     (status, assembly, district, caller, designation, completion, …)
//   - a per-day time series for the bar chart
//
// It reuses the report engine's summary (GROUP BY) mode, so role scope, geo
// filters, time range and every other filter are applied identically to the
// on-screen report. Only dimensions the module actually declares in groupBy
// are included, so it works for any module without per-module code.

// Preferred order + friendly section titles. Keys must match module.groupBy keys.
const BREAKDOWN_ORDER = [
  ["status", "By Call Status"],
  ["sentiment", "By Sentiment"],
  ["is_completed", "By Completion"],
  ["assembly", "By Assembly"],
  ["district", "By District"],
  ["caller", "By Caller"],
  ["assigned_to", "By Assigned Caller"],
  ["designation", "By Designation"],
  ["worker_type", "By Member Type"],
  ["membership_status", "By Membership"],
  ["status_worker", "By Status"],
];

export async function buildAnalytics({ moduleKey, session, body }) {
  const module = getModule(moduleKey);
  if (!module) return { error: "Unknown module", status: 404 };

  const gbKeys = new Set((module.groupBy || []).map((g) => g.key));

  // Total records for the current filter set (detail mode, page 1, size 1 → total).
  const base = await runReport({
    moduleKey, session,
    body: { ...body, group_by: null, page: 1, pageSize: 1 },
  });
  if (base.error) return base;
  const total = Number(base.total || 0);

  // Breakdown sections — one grouped query per available dimension.
  const sections = [];
  for (const [key, label] of BREAKDOWN_ORDER) {
    if (!gbKeys.has(key)) continue;
    const r = await runReport({ moduleKey, session, body: { ...body, group_by: key } });
    if (r.error || !r.rows?.length) continue;
    sections.push({
      key,
      label,
      groupLabel: r.group_label,
      total: Number(r.totalRecords || 0),
      rows: r.rows.map((x) => ({
        group_key: x.group_key ?? "(none)",
        count: Number(x.count),
        pct: total ? Math.round((Number(x.count) / total) * 1000) / 10 : 0,
      })),
    });
  }

  // Per-day time series (chronological) for the bar chart.
  let timeseries = null;
  if (gbKeys.has("day")) {
    const r = await runReport({ moduleKey, session, body: { ...body, group_by: "day" } });
    if (!r.error && r.rows?.length) {
      timeseries = r.rows
        .map((x) => ({ day: String(x.group_key ?? ""), count: Number(x.count) }))
        .filter((x) => x.day && x.day !== "(none)")
        .sort((a, b) => a.day.localeCompare(b.day))
        .slice(-31); // last ~month of days keeps the chart readable
    }
  }

  return { module: module.label, total, sections, timeseries };
}
