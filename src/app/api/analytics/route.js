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
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");
    const districtId = searchParams.get("district_id");

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

    // 2. Bar: top agents by total calls — only count actual callers, not oversight roles
    const topAgents = await query(
      `SELECT u.username AS agent, COUNT(c.id) AS calls,
              SUM(CASE WHEN cs.name = 'Phone Picked' THEN 1 ELSE 0 END) AS connected
         FROM calls c
         JOIN users u ON u.id = c.user_id
         LEFT JOIN call_statuses cs ON cs.id = c.status_id
         ${where}
           AND u.role IN ('caller','user','agent')
         GROUP BY u.id, u.username
         ORDER BY calls DESC
         LIMIT 10`,
      params
    );

    // 3. Pie: status breakdown
    const statusPie = await query(
      `SELECT cs.name AS status, COUNT(c.id) AS n
         FROM calls c
         LEFT JOIN call_statuses cs ON cs.id = c.status_id
         ${where}
         GROUP BY cs.name`,
      params
    );

    // 4. Stacked bar: status mix per district (top 8 districts)
    const stackedDistrict = await query(
      `SELECT ld.name AS district,
              SUM(CASE WHEN cs.name = 'Phone Picked' THEN 1 ELSE 0 END) AS connected,
              SUM(CASE WHEN cs.name = 'Not Picked' THEN 1 ELSE 0 END) AS no_answer,
              SUM(CASE WHEN cs.name = 'Wrong Number' THEN 1 ELSE 0 END) AS wrong_number,
              SUM(CASE WHEN cs.name = 'Rudely Behaved' THEN 1 ELSE 0 END) AS rejected,
              SUM(CASE WHEN cs.name = 'Busy' THEN 1 ELSE 0 END) AS busy,
              SUM(CASE WHEN cs.name = 'Switched Off' THEN 1 ELSE 0 END) AS switched_off,
              COUNT(c.id) AS total
         FROM calls c
         LEFT JOIN call_statuses cs ON cs.id = c.status_id
         LEFT JOIN locations ld ON ld.id = c.district_id
         ${where}
         GROUP BY c.district_id, ld.name
         HAVING ld.name IS NOT NULL
         ORDER BY total DESC
         LIMIT 8`,
      params
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

    // 7. Radar: 5 axes per agent — callers only
    const radarAgents = await query(
      `SELECT u.username AS agent,
              COUNT(c.id) AS total,
              SUM(CASE WHEN cs.name = 'Phone Picked' THEN 1 ELSE 0 END) AS connected,
              COALESCE(ROUND(AVG(c.duration_seconds)), 0) AS avg_duration,
              SUM(CASE WHEN c.sentiment IN ('positive','supporter') THEN 1 ELSE 0 END) AS interested,
              SUM(CASE WHEN c.is_follow_up_required = 1 THEN 1 ELSE 0 END) AS follow_ups
         FROM calls c
         JOIN users u ON u.id = c.user_id
         LEFT JOIN call_statuses cs ON cs.id = c.status_id
         ${where}
           AND u.role IN ('caller','user','agent')
         GROUP BY u.id, u.username
         ORDER BY total DESC
         LIMIT 5`,
      params
    );

    // 8. Funnel: contacts pipeline (NOT range-filtered — pipeline is structural)
    const funnelParams = [];
    let fundWhere = "WHERE 1=1";
    if (districtId) { fundWhere += " AND ct.district_id = ?"; funnelParams.push(districtId); }
    const [[funnel]] = await query(
      `SELECT
         (SELECT COUNT(*) FROM contacts ct ${fundWhere}) AS loaded,
         (SELECT COUNT(*) FROM contacts ct ${fundWhere} AND assigned_to_user_id IS NOT NULL) AS assigned,
         (SELECT COUNT(*) FROM contacts ct ${fundWhere} AND id IN (SELECT DISTINCT contact_id FROM calls WHERE contact_id IS NOT NULL)) AS attempted,
         (SELECT COUNT(*) FROM contacts ct ${fundWhere} AND is_completed = 1) AS completed`,
      [...funnelParams, ...funnelParams, ...funnelParams, ...funnelParams]
    ).then((r) => [r]);

    // 9. Treemap: calls per district (full set, with zone label for color grouping)
    const treemap = await query(
      `SELECT ld.name AS district, lz.name AS zone, COUNT(c.id) AS n
         FROM calls c
         JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations lls ON lls.id = ld.parent_id
         LEFT JOIN locations lz ON lz.id = lls.parent_id
         ${where}
         GROUP BY ld.id, ld.name, lz.name
         HAVING n > 0
         ORDER BY n DESC`,
      params
    );

    return NextResponse.json({
      line,
      topAgents,
      statusPie,
      stackedDistrict,
      cumulative,
      heatmap,
      radarAgents,
      funnel,
      treemap,
    });
  } catch (err) {
    console.error("analytics error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
