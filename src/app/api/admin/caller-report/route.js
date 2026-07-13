import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

// Per-caller performance report for the admin dashboard: call volume, outcome
// (review status) breakdown, connect rate, sentiment, follow-ups and a ranking.
//
// Some deployments predate the supervisor-schema columns on `calls`
// (duration_seconds / sentiment / is_follow_up_required) and the contacts
// link (contact_id). We detect which exist and fold missing ones to 0/NULL so
// the report never 500s on a lagging schema.
let callColumnsPromise;
async function getCallColumns() {
  if (!callColumnsPromise) {
    callColumnsPromise = query(
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'calls'`
    )
      .then((rows) => new Set(rows.map((r) => r.name)))
      .catch((err) => { callColumnsPromise = undefined; throw err; });
  }
  return callColumnsPromise;
}

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");

    const cols = await getCallColumns();
    const has = (c) => cols.has(c);
    // Optional-column-aware expressions.
    const durAvg = has("duration_seconds") ? "ROUND(AVG(c.duration_seconds), 0)" : "0";
    const durSum = has("duration_seconds") ? "COALESCE(SUM(c.duration_seconds), 0)" : "0";
    const followUps = has("is_follow_up_required")
      ? "SUM(CASE WHEN c.is_follow_up_required = 1 THEN 1 ELSE 0 END)" : "0";
    const interested = has("sentiment")
      ? "SUM(CASE WHEN c.sentiment IN ('positive','supporter') THEN 1 ELSE 0 END)" : "0";
    const negative = has("sentiment")
      ? "SUM(CASE WHEN c.sentiment IN ('negative','opponent') THEN 1 ELSE 0 END)" : "0";
    const uniqueReached = has("contact_id") ? "COUNT(DISTINCT c.contact_id)" : "0";

    // Date range is applied in the LEFT JOIN's ON clause so callers with zero
    // calls in the window still appear (with all-zero stats).
    const params = [];
    let joinExtra = "";
    if (dateFrom) { joinExtra += " AND DATE(c.called_at) >= ?"; params.push(dateFrom); }
    if (dateTo) { joinExtra += " AND DATE(c.called_at) <= ?"; params.push(dateTo); }

    const rows = await query(
      `SELECT
         u.id   AS user_id,
         u.username AS name,
         u.last_seen_at,
         COUNT(c.id) AS total_calls,
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
       LEFT JOIN calls c ON c.user_id = u.id ${joinExtra}
       LEFT JOIN call_statuses cs ON cs.id = c.status_id
       WHERE u.role IN ('caller', 'user', 'agent')
       GROUP BY u.id, u.username, u.last_seen_at`,
      params
    );

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
          connected,
          connect_rate: total ? Math.round((connected / total) * 100) : 0,
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
        t.connected += r.connected;
        t.follow_ups += r.follow_ups;
        t.interested += r.interested;
        return t;
      },
      { callers: 0, total_calls: 0, connected: 0, follow_ups: 0, interested: 0 }
    );
    totals.connect_rate = totals.total_calls ? Math.round((totals.connected / totals.total_calls) * 100) : 0;

    // Combined calls per day across ALL callers, for the same window.
    const dayParams = [];
    let dayWhere = "WHERE 1=1";
    if (dateFrom) { dayWhere += " AND DATE(c.called_at) >= ?"; dayParams.push(dateFrom); }
    if (dateTo) { dayWhere += " AND DATE(c.called_at) <= ?"; dayParams.push(dateTo); }
    const dailyRows = await query(
      `SELECT DATE(c.called_at) AS day,
              COUNT(*) AS total_calls,
              SUM(CASE WHEN cs.name = 'Phone Picked' THEN 1 ELSE 0 END) AS connected,
              COUNT(DISTINCT c.user_id) AS active_callers
         FROM calls c
         LEFT JOIN call_statuses cs ON cs.id = c.status_id
         JOIN users u ON u.id = c.user_id AND u.role IN ('caller','user','agent')
         ${dayWhere}
        GROUP BY DATE(c.called_at)
        ORDER BY day DESC
        LIMIT 60`,
      dayParams
    );
    const daily = dailyRows.map((d) => ({
      day: d.day,
      total_calls: Number(d.total_calls) || 0,
      connected: Number(d.connected) || 0,
      active_callers: Number(d.active_callers) || 0,
    }));

    return NextResponse.json({ callers, totals, daily });
  } catch (err) {
    console.error("admin/caller-report error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
