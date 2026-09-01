import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { scopeFilterSync } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { districtWorkerStats } from "@/lib/districtStats";
import { contactsByAssembly } from "@/lib/workerCounts";

// Powers /dashboard/analytics. Returns datasets for all charts in one round-trip.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    // Normal users: oversight only. Page-restricted users: only if "analytics"
    // is one of their assigned pages (role ignored). Same source as the UI.
    if (!(await pageAllowed(session, "analytics", session && isSupervisor(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    // `from`/`to` are accepted alongside the legacy `date_from`/`date_to` so the
    // Top Agents card can drive its own independent date filter.
    const dateFrom = searchParams.get("from") || searchParams.get("date_from");
    const dateTo = searchParams.get("to") || searchParams.get("date_to");
    const districtId = searchParams.get("district_id");
    // When set (e.g. "top_agents") the route returns ONLY that section's data —
    // used by the Top Agents card so its date filter never disturbs the other
    // charts (which keep using the shared filter bar).
    const section = searchParams.get("section");

    const params = [];
    let where = "WHERE 1=1";
    if (dateFrom)   { where += " AND DATE(c.called_at) >= ?"; params.push(dateFrom); }
    if (dateTo)     { where += " AND DATE(c.called_at) <= ?"; params.push(dateTo); }
    if (districtId) { where += " AND c.district_id = ?";       params.push(districtId); }

    // Geographic scope: zone/district/assembly admins are restricted to their territory.
    const scope = scopeFilterSync(session.user, "c");
    where += " " + scope.where;
    params.push(...scope.params);

    // 1. Line: calls per day
    const line = await query(
      `SELECT DATE(c.called_at) AS day, COUNT(*) AS calls
         FROM calls c
         ${where}
         GROUP BY DATE(c.called_at)
         ORDER BY day ASC`,
      params
    );

    // 2. Bar: top agents for the selected period — total calls + connected
    // ("Phone Picked"), only actual callers (not oversight roles). Ranked by
    // connected calls (then total), matching the caller-ranking preference.
    const topAgents = await query(
      `SELECT u.username AS agent, COUNT(c.id) AS calls,
              SUM(CASE WHEN cs.name = 'Phone Picked' THEN 1 ELSE 0 END) AS connected
         FROM calls c
         JOIN users u ON u.id = c.user_id
         LEFT JOIN call_statuses cs ON cs.id = c.status_id
         ${where}
           AND u.role IN ('caller','user','agent')
         GROUP BY u.id, u.username
         ORDER BY connected DESC, calls DESC
         LIMIT 10`,
      params
    );

    // Independent Top Agents fetch (its own date range) — return ONLY this
    // section so the other charts are never affected.
    if (section === "top_agents") {
      return NextResponse.json({ topAgents });
    }

    // 3. Pie: status breakdown
    const statusPie = await query(
      `SELECT cs.name AS status, COUNT(c.id) AS n
         FROM calls c
         LEFT JOIN call_statuses cs ON cs.id = c.status_id
         ${where}
         GROUP BY cs.name`,
      params
    );

    // 4. Stacked bar: status mix for EVERY district in the master list
    // (Chhattisgarh's full set), so a district with no calls still appears with
    // zeros. Starts FROM the district master and LEFT JOINs calls; the date +
    // role-scope conditions live in the JOIN's ON clause so they filter the
    // calls WITHOUT dropping any district. The single-district global filter is
    // intentionally NOT applied here — this chart's whole point is the
    // all-districts breakdown.
    const sdParams = [];
    let sdOn = "c.district_id = ld.id";
    if (dateFrom) { sdOn += " AND DATE(c.called_at) >= ?"; sdParams.push(dateFrom); }
    if (dateTo)   { sdOn += " AND DATE(c.called_at) <= ?"; sdParams.push(dateTo); }
    // Scope the CALLS to the viewer's territory (empty for super_admin/state_admin/
    // supervisor → all calls). Applied in the ON clause so out-of-scope districts
    // still show, just with zero counts.
    const sdScope = scopeFilterSync(session.user, "c");
    sdOn += " " + sdScope.where;
    sdParams.push(...sdScope.params);
    const stackedDistrict = await query(
      `SELECT ld.name AS district,
              SUM(CASE WHEN cs.name = 'Phone Picked' THEN 1 ELSE 0 END) AS connected,
              SUM(CASE WHEN cs.name = 'Not Picked' THEN 1 ELSE 0 END) AS no_answer,
              SUM(CASE WHEN cs.name = 'Wrong Number' THEN 1 ELSE 0 END) AS wrong_number,
              SUM(CASE WHEN cs.name = 'Rudely Behaved' THEN 1 ELSE 0 END) AS rejected,
              SUM(CASE WHEN cs.name = 'Busy' THEN 1 ELSE 0 END) AS busy,
              SUM(CASE WHEN cs.name = 'Switched Off' THEN 1 ELSE 0 END) AS switched_off,
              COUNT(c.id) AS total
         FROM locations ld
         LEFT JOIN calls c ON ${sdOn}
         LEFT JOIN call_statuses cs ON cs.id = c.status_id
        WHERE ld.type = 'district'
        GROUP BY ld.id, ld.name
        ORDER BY total DESC, ld.name ASC`,
      sdParams
    );

    // 5. Area: cumulative completed contacts over time (uses calls timeline as proxy)
    const cumulativeRaw = await query(
      `SELECT DATE(c.called_at) AS day,
              SUM(CASE WHEN cs.name = 'Phone Picked' THEN 1 ELSE 0 END) AS connected
         FROM calls c
         LEFT JOIN call_statuses cs ON cs.id = c.status_id
         ${where}
         GROUP BY DATE(c.called_at)
         ORDER BY day ASC`,
      params
    );
    let running = 0;
    const cumulative = cumulativeRaw.map((r) => {
      running += Number(r.connected) || 0;
      return { day: r.day, cumulative_connected: running };
    });

    // 6. Activity heat map — one row per ACTUAL calendar DATE (not day-of-week),
    // hour-by-hour, so a specific day with zero calls shows as a completely
    // blank/inactive row instead of borrowing activity from other same-weekday
    // dates (the old day-of-week aggregate did the latter, which read as false
    // activity on quiet days).
    //
    // • Single source of truth: a plain COUNT over `calls`, grouped by the IST
    //   calendar day AND hour of `called_at` — each call counted once (no joins
    //   → no duplicates), non-cumulative (each cell = ONLY that hour's calls).
    // • Timezone: `called_at` is UTC; the day/hour buckets and the window bounds
    //   are all derived in IST (+05:30), matching the rest of the dashboard.
    // • Window: the selected date range, else the last 14 IST days; capped at 31
    //   rows so the grid stays readable/performant. EVERY date in the window is
    //   returned (including zero-call days → blank), so "no calls that day" is
    //   visibly inactive rather than missing.
    const IST = "+05:30";
    const istTs = `CONVERT_TZ(c.called_at, '+00:00', '${IST}')`;
    const IST_MS = 5.5 * 3600 * 1000;
    const istToday = () => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
    const addDaysStr = (ymd, n) => {
      const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const daySpan = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

    const HEAT_DEFAULT_DAYS = 14, HEAT_MAX_DAYS = 31;
    let winTo = dateTo || istToday();
    let winFrom = dateFrom || addDaysStr(winTo, -(HEAT_DEFAULT_DAYS - 1));
    if (daySpan(winFrom, winTo) < 0) winFrom = winTo;               // guard inverted range
    if (daySpan(winFrom, winTo) > HEAT_MAX_DAYS - 1) winFrom = addDaysStr(winTo, -(HEAT_MAX_DAYS - 1));

    // Heat-map-specific WHERE: keep the territory/district scope but bound dates
    // by the IST window (NOT the UTC-DATE range the other charts use), so a call
    // near midnight lands on its correct IST day.
    let heatWhere = "WHERE 1=1";
    const heatParams = [];
    if (districtId) { heatWhere += " AND c.district_id = ?"; heatParams.push(districtId); }
    heatWhere += " " + scope.where; heatParams.push(...scope.params);
    heatWhere += ` AND c.called_at >= CONVERT_TZ(CONCAT(?,' 00:00:00'),'${IST}','+00:00')`
              +  ` AND c.called_at <  CONVERT_TZ(CONCAT(?,' 00:00:00'),'${IST}','+00:00') + INTERVAL 1 DAY`;
    heatParams.push(winFrom, winTo);

    const heatRows = await query(
      `SELECT DATE(${istTs}) AS day, HOUR(${istTs}) AS hour, COUNT(*) AS n
         FROM calls c
         ${heatWhere}
         GROUP BY DATE(${istTs}), HOUR(${istTs})`,
      heatParams
    );
    // Index the counts, then emit EVERY date in the window (zero-call days
    // included) so the front end can render them blank.
    const byDayHour = new Map();
    for (const r of heatRows) {
      const day = String(r.day).slice(0, 10);
      if (!byDayHour.has(day)) byDayHour.set(day, {});
      byDayHour.get(day)[Number(r.hour)] = Number(r.n) || 0;
    }
    const heatmap = [];
    for (let d = winTo; ; d = addDaysStr(d, -1)) {            // newest day first
      const hours = byDayHour.get(d) || {};
      const total = Object.values(hours).reduce((s, v) => s + v, 0);
      heatmap.push({ day: d, hours, total });
      if (d === winFrom) break;
    }

    // 7. Treemap: workers per district. Built FROM the authoritative district
    // master (locations of type 'district') so every in-scope district is
    // considered, then the worker value comes from the SAME contacts-based count
    // (contactsByDistrict) the Strength page, Area Ranking and Organization Map
    // use — so all four agree and the block totals reconcile with the underlying
    // dataset. Role-scoped with the same rules as those views. A treemap can't
    // render a zero-area block, so districts with no workers are dropped from the
    // drawing (their value is 0 and adds nothing to the total). The date filter
    // doesn't apply (workforce isn't date-based).
    let treemap = [];
    try {
      // From the ONE shared district-stats service (same numbers as Strength /
      // Area Ranking / Organization Map). EVERY in-scope district is included —
      // including zero-worker districts (they are NOT dropped) — each with its
      // actual workers, required target and strength %.
      treemap = (await districtWorkerStats(session, { districtId: districtId || undefined }))
        .map((d) => ({
          id: d.id,
          district: d.district,
          zone: d.zone,
          count: d.actualWorkers,
          requiredWorkers: d.requiredWorkers,
          strengthPercentage: d.strengthPercentage,
        }))
        .sort((a, b) => b.count - a.count || a.district.localeCompare(b.district));
    } catch (e) {
      console.error("analytics treemap (workers by district) failed:", e?.code || e?.message);
      treemap = [];
    }

    // 8. Workers by Assembly — EVERY master assembly (locations of type
    // 'assembly') is listed, including ones with zero workers, so all 90 appear.
    // The worker value is the SAME contacts-based, person-aware count as the
    // district numbers (contactsByAssembly), keyed by assembly_id — no text
    // matching, nothing hardcoded — and it reconciles with the underlying data.
    let assemblyWorkers = [];
    try {
      const [asmRows, counts] = await Promise.all([
        query(
          `SELECT a.id, a.name,
                  COALESCE(d.name, '') AS district
             FROM locations a
             LEFT JOIN locations d ON d.id = a.parent_id AND d.type = 'district'
            WHERE a.type = 'assembly'
            ORDER BY a.name ASC`
        ),
        contactsByAssembly(),
      ]);
      assemblyWorkers = asmRows
        .map((a) => ({ id: a.id, assembly: a.name, district: a.district || null, workers: Number(counts.get(a.id) || 0) }))
        .sort((x, y) => y.workers - x.workers || String(x.assembly).localeCompare(String(y.assembly)));
    } catch (e) {
      console.error("analytics assemblyWorkers failed:", e?.code || e?.message);
      assemblyWorkers = [];
    }

    return NextResponse.json({
      line,
      topAgents,
      statusPie,
      stackedDistrict,
      cumulative,
      heatmap,
      treemap,
      assemblyWorkers,
    });
  } catch (err) {
    console.error("analytics error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
