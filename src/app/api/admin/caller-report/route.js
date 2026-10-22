import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, scopeFilterSync, loadUserScope } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { connectRate } from "@/lib/callerMetrics";
import { callsUnion, CALL_TYPE_SPLIT, assignmentCountsByCaller, EMPTY_ASSIGNMENT } from "@/lib/allCalls";

// Per-caller performance report for the admin dashboard: call volume, outcome
// (review status) breakdown, connect rate, sentiment, follow-ups and a ranking.
//
// Counts BOTH call types — Regular Calls and Unfiltered Calls — through the
// shared lib/allCalls source (each call record once; columns a deployment lacks
// read as NULL there), with the Regular / Unfiltered split alongside.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    // Role OR a Page-Access grant for this page (managed override) — mirrors the
    // client guard and the sidebar, so a granted user's data actually loads.
    if (!(await pageAllowed(session, "caller_report", session && isAdmin(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    // Reports Audit Phase 1/2 (security fix): this endpoint had NO territory
    // restriction at all — every caller nationwide, regardless of the
    // viewer's own scope, same class of gap as supervisor/export/[report].
    // It is the one every admin tier's nav actually points to (Phase 0), so
    // this is the highest-traffic instance of the gap, not a minor one.
    await loadUserScope(session, query);

    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");
    const granularity = ["day", "week", "month"].includes(searchParams.get("granularity"))
      ? searchParams.get("granularity") : "day";

    // Clamp each row's duration to non-negative before aggregating, so a legacy
    // invalid (negative) duration can never produce a negative average/total.
    const durAvg = "ROUND(AVG(GREATEST(COALESCE(c.duration_seconds, 0), 0)), 0)";
    const durSum = "COALESCE(SUM(GREATEST(COALESCE(c.duration_seconds, 0), 0)), 0)";
    const followUps = "SUM(CASE WHEN c.is_follow_up_required = 1 THEN 1 ELSE 0 END)";
    const interested = "SUM(CASE WHEN c.sentiment IN ('positive','supporter') THEN 1 ELSE 0 END)";
    const negative = "SUM(CASE WHEN c.sentiment IN ('negative','opponent','not_supporter') THEN 1 ELSE 0 END)";
    const uniqueReached = "COUNT(DISTINCT c.reach_key)";

    // Date range + territory scope are applied INSIDE the calls source, which is
    // then LEFT JOINed so callers with zero calls in the window still appear.
    const params = [];
    let callWhere = "";
    if (dateFrom) { callWhere += " AND DATE(c.called_at) >= ?"; params.push(dateFrom); }
    if (dateTo) { callWhere += " AND DATE(c.called_at) <= ?"; params.push(dateTo); }
    const scope = scopeFilterSync(session.user, "c", { cols: ["zone_id", "district_id", "assembly_id"] });
    callWhere += " " + scope.where;
    params.push(...scope.params);
    const src = await callsUnion({ where: callWhere, params });

    const rows = await query(
      `SELECT
         u.id   AS user_id,
         u.username AS name,
         u.last_seen_at,
         COUNT(c.id) AS total_calls,
         ${CALL_TYPE_SPLIT},
         SUM(CASE WHEN cs.name = 'Phone Picked' THEN 1 ELSE 0 END) AS connected,
         SUM(CASE WHEN cs.name = 'Not Picked'   THEN 1 ELSE 0 END) AS not_picked,
         SUM(CASE WHEN cs.name = 'Wrong Number' THEN 1 ELSE 0 END) AS wrong_number,
         SUM(CASE WHEN cs.name = 'Rudely Behaved' THEN 1 ELSE 0 END) AS rude,
         ${uniqueReached} AS unique_reached,
         ${durAvg} AS avg_duration_seconds,
         ${durSum} AS total_talk_seconds,
         ${followUps} AS follow_ups,
         ${interested} AS interested,
         ${negative} AS negative,
         COUNT(DISTINCT DATE(c.called_at)) AS active_days,
         MAX(c.called_at) AS last_call_at
       FROM users u
       LEFT JOIN ${src.sql} c ON c.user_id = u.id
       LEFT JOIN call_statuses cs ON cs.id = c.status_id
       WHERE u.role IN ('caller', 'user', 'agent')
       GROUP BY u.id, u.username, u.last_seen_at`,
      src.params
    );
    // Assigned / Completed / Pending (current state): Regular contacts +
    // Unfiltered Contacts assigned to each caller.
    const assignment = await assignmentCountsByCaller();

    // Numeric coercion + derived connect rate, then rank by connected calls
    // (the meaningful outcome), breaking ties on total volume.
    const callers = rows
      .map((r) => {
        const total = Number(r.total_calls) || 0;
        const connected = Number(r.connected) || 0;
        return {
          user_id: r.user_id,
          name: r.name,
          last_seen_at: r.last_seen_at,
          last_call_at: r.last_call_at,
          total_calls: total,
          regular_calls: Number(r.regular_calls) || 0,
          unfiltered_calls: Number(r.unfiltered_calls) || 0,
          ...(assignment.get(Number(r.user_id)) || EMPTY_ASSIGNMENT),
          connected,
          connect_rate: connectRate(total, connected),
          not_picked: Number(r.not_picked) || 0,
          wrong_number: Number(r.wrong_number) || 0,
          rude: Number(r.rude) || 0,
          unique_reached: Number(r.unique_reached) || 0,
          avg_duration_seconds: Number(r.avg_duration_seconds) || 0,
          total_talk_seconds: Number(r.total_talk_seconds) || 0,
          follow_ups: Number(r.follow_ups) || 0,
          interested: Number(r.interested) || 0,
          negative: Number(r.negative) || 0,
          active_days: Number(r.active_days) || 0,
        };
      })
      .sort((a, b) => b.connected - a.connected || b.total_calls - a.total_calls || a.name.localeCompare(b.name))
      .map((r, i) => ({ ...r, rank: i + 1 }));

    // Rolled-up totals for the summary tiles.
    const totals = callers.reduce(
      (t, r) => {
        t.callers += 1;
        t.total_calls += r.total_calls;
        t.regular_calls += r.regular_calls;
        t.unfiltered_calls += r.unfiltered_calls;
        t.assigned += r.assigned;
        t.completed += r.completed;
        t.pending += r.pending;
        t.connected += r.connected;
        t.follow_ups += r.follow_ups;
        t.interested += r.interested;
        return t;
      },
      { callers: 0, total_calls: 0, regular_calls: 0, unfiltered_calls: 0, assigned: 0, completed: 0, pending: 0, connected: 0, follow_ups: 0, interested: 0 }
    );
    totals.connect_rate = connectRate(totals.total_calls, totals.connected);

    // Combined calls per day/week/month across ALL callers, for the same
    // window. Grouping is done on the IST calendar day (calls timestamp is
    // stored in UTC), matching the rest of the app's date handling.
    const dayParams = [];
    let dayWhere = "";
    if (dateFrom) { dayWhere += " AND DATE(c.called_at) >= ?"; dayParams.push(dateFrom); }
    if (dateTo) { dayWhere += " AND DATE(c.called_at) <= ?"; dayParams.push(dateTo); }
    dayWhere += " " + scope.where;
    dayParams.push(...scope.params);
    const daySrc = await callsUnion({ where: dayWhere, params: dayParams });
    const istCalled = "CONVERT_TZ(c.called_at,'+00:00','+05:30')";
    const bucketExpr = granularity === "month" ? `DATE_FORMAT(${istCalled},'%Y-%m-01')`
      : granularity === "week" ? `DATE_SUB(DATE(${istCalled}), INTERVAL WEEKDAY(${istCalled}) DAY)`
      : `DATE(${istCalled})`;
    const dailyRows = await query(
      `SELECT ${bucketExpr} AS day,
              COUNT(*) AS total_calls,
              ${CALL_TYPE_SPLIT},
              SUM(CASE WHEN cs.name = 'Phone Picked' THEN 1 ELSE 0 END) AS connected,
              COUNT(DISTINCT c.user_id) AS active_callers
         FROM ${daySrc.sql} c
         LEFT JOIN call_statuses cs ON cs.id = c.status_id
         JOIN users u ON u.id = c.user_id AND u.role IN ('caller','user','agent')
        GROUP BY day
        ORDER BY day DESC
        LIMIT ${granularity === "month" ? 24 : granularity === "week" ? 52 : 60}`,
      daySrc.params
    );
    const daily = dailyRows.map((d) => ({
      day: d.day,
      total_calls: Number(d.total_calls) || 0,
      regular_calls: Number(d.regular_calls) || 0,
      unfiltered_calls: Number(d.unfiltered_calls) || 0,
      connected: Number(d.connected) || 0,
      active_callers: Number(d.active_callers) || 0,
    }));

    return NextResponse.json({ callers, totals, daily });
  } catch (err) {
    console.error("admin/caller-report error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
