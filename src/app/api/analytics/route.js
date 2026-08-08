import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { scopeFilterSync } from "@/lib/permissions";
import { query } from "@/lib/db";

// Powers /dashboard/analytics. Returns datasets for all charts in one round-trip.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisor(session)) {
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

    // 6. Heatmap: hour-of-day × day-of-week
    const heatmapRaw = await query(
      `SELECT DAYOFWEEK(c.called_at) AS dow, HOUR(c.called_at) AS hour, COUNT(*) AS n
         FROM calls c
         ${where}
         GROUP BY DAYOFWEEK(c.called_at), HOUR(c.called_at)`,
      params
    );
    // MySQL DAYOFWEEK: 1=Sunday … 7=Saturday. Build a 7×24 matrix.
    const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    heatmapRaw.forEach((r) => {
      const d = (r.dow - 1) % 7; // 0..6 (Sun..Sat)
      heatmap[d][r.hour] = Number(r.n);
    });

    // 7. Treemap: number of WORKERS assigned to each district (the actual
    // workers.district_id count — NOT calls/contacts). Permission-scoped to the
    // viewer's territory; districts with zero workers are omitted (HAVING). The
    // date filter does not apply (workers aren't date-based). Wrapped so a
    // missing/legacy `workers` table degrades to an empty treemap instead of
    // failing the whole analytics response.
    let treemap = [];
    try {
      const wParams = [];
      let wWhere = "WHERE w.district_id IS NOT NULL";
      if (districtId) { wWhere += " AND w.district_id = ?"; wParams.push(districtId); }
      const wScope = scopeFilterSync(session.user, "w");
      wWhere += " " + wScope.where;
      wParams.push(...wScope.params);
      treemap = await query(
        `SELECT ld.name AS district, lz.name AS zone, COUNT(w.id) AS count
           FROM workers w
           JOIN locations ld ON ld.id = w.district_id
           LEFT JOIN locations lls ON lls.id = ld.parent_id
           LEFT JOIN locations lz ON lz.id = lls.parent_id
           ${wWhere}
           GROUP BY ld.id, ld.name, lz.name
           HAVING count > 0
           ORDER BY count DESC`,
        wParams
      );
    } catch (e) {
      console.error("analytics treemap (workers by district) failed:", e?.code || e?.message);
      treemap = [];
    }

    return NextResponse.json({
      line,
      topAgents,
      statusPie,
      stackedDistrict,
      cumulative,
      heatmap,
      treemap,
    });
  } catch (err) {
    console.error("analytics error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
