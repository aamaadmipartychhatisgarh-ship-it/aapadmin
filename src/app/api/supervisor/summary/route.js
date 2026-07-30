import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { query } from "@/lib/db";

// Supervisor overview — every metric is calculated live from the calls table for
// the SELECTED report date/range, defaulting to TODAY. All date/time math is in
// the application timezone (Asia/Kolkata, a fixed +05:30 with no DST); called_at
// is a UTC TIMESTAMP so we CONVERT_TZ it consistently. Nothing here is cached or
// a lifetime total.
const IST = "+05:30";

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisor(session)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const date_from = searchParams.get("date_from");
    const date_to = searchParams.get("date_to");

    // IST wall-clock date of a call, and "today" / "now" in IST.
    const dateExpr = `DATE(CONVERT_TZ(c.called_at,'+00:00','${IST}'))`;
    const [nowIST] = await query(
      `SELECT DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','${IST}')) AS today,
              HOUR(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','${IST}')) AS cur_hour`
    );
    const today = String(nowIST?.today ?? "");

    // Effective range (inclusive). No selection → today only.
    const from = date_from || (date_to ? null : today);
    const to = date_to || (date_from ? null : today);

    let where = "WHERE 1=1";
    const params = [];
    if (from) { where += ` AND ${dateExpr} >= ?`; params.push(from); }
    if (to)   { where += ` AND ${dateExpr} <= ?`; params.push(to); }

    // ---- KPI tally (8 cards) — one grouped pass over the selected range ----
    const [agg] = await query(
      `SELECT
         COUNT(*)                            AS total,
         SUM(cs.name = 'Phone Picked')       AS connected,
         SUM(cs.name = 'Not Picked')         AS no_answer,
         SUM(cs.name = 'Switched Off')       AS switched_off,
         SUM(cs.name = 'Busy')               AS busy,
         SUM(cs.name = 'Wrong Number')       AS wrong_number,
         SUM(cs.name = 'Rudely Behaved')     AS rejected,
         SUM(c.follow_up_date IS NOT NULL)   AS follow_up
       FROM calls c
       LEFT JOIN call_statuses cs ON cs.id = c.status_id
       ${where}`,
      params
    );
    const n = (v) => Number(v) || 0;
    const tally = {
      total: n(agg?.total),
      connected: n(agg?.connected),
      no_answer: n(agg?.no_answer),
      switched_off: n(agg?.switched_off),
      busy: n(agg?.busy),
      wrong_number: n(agg?.wrong_number),
      rejected: n(agg?.rejected),
      follow_up: n(agg?.follow_up),
    };
    // "other" = statuses not covered above (kept for the Status Breakdown pie).
    tally.other = Math.max(
      0,
      tally.total - (tally.connected + tally.no_answer + tally.switched_off + tally.busy + tally.wrong_number + tally.rejected)
    );

    // ---- Calls over time (grouped by IST date across the range) ----
    const timelineRows = await query(
      `SELECT ${dateExpr} AS date, COUNT(*) AS count
         FROM calls c ${where}
        GROUP BY date ORDER BY date`,
      params
    );
    const timeline = timelineRows.map((r) => ({ date: String(r.date), count: n(r.count) }));

    // ---- Hourly productivity (IST hour, capped at the current hour when the
    //      range reaches today; a purely historical range shows all 24) ----
    const hourRows = await query(
      `SELECT HOUR(CONVERT_TZ(c.called_at,'+00:00','${IST}')) AS h, COUNT(*) AS n
         FROM calls c ${where} GROUP BY h`,
      params
    );
    const includesToday = !to || String(to) >= today;
    const maxHour = includesToday ? Number(nowIST?.cur_hour ?? 23) : 23;
    const hourCounts = {};
    hourRows.forEach((r) => { hourCounts[Number(r.h)] = n(r.n); });
    const hourly = [];
    for (let h = 0; h <= maxHour; h++) hourly.push({ hour: h, calls: hourCounts[h] || 0 });

    // ---- Best caller (actual caller roles only) ----
    const CALLER_ROLES = "('caller','user','agent')";
    const [best] = await query(
      `SELECT u.username AS name, COUNT(*) AS calls
         FROM calls c JOIN users u ON u.id = c.user_id
        ${where} AND u.role IN ${CALLER_ROLES}
        GROUP BY u.id ORDER BY calls DESC LIMIT 1`,
      params
    );

    return Response.json({
      tally,
      hourly,
      timeline,
      best_caller: best ? { name: best.name, calls: n(best.calls) } : null,
      range: { from, to },
      is_today: from === today && to === today,
      today,
    });
  } catch (err) {
    console.error("supervisor/summary error:", err);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
