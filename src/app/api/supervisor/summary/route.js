import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { query } from "@/lib/db";
import { tallyBuckets } from "@/lib/supervisor";

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisor(session)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const date_from = searchParams.get("date_from");
    const date_to = searchParams.get("date_to");

    let where = "WHERE 1=1";
    const params = [];
    if (date_from) { where += " AND DATE(c.called_at) >= ?"; params.push(date_from); }
    if (date_to)   { where += " AND DATE(c.called_at) <= ?"; params.push(date_to); }

    const calls = await query(
      `SELECT c.id, c.called_at, cs.name AS status_name, c.user_id,
              u.username AS agent_name, u.role AS agent_role
         FROM calls c
         LEFT JOIN call_statuses cs ON c.status_id = cs.id
         LEFT JOIN users u ON c.user_id = u.id
         ${where}`,
      params
    );

    const tally = tallyBuckets(calls);

    // Hourly productivity — real-time, in the application timezone (Asia/Kolkata,
    // a fixed +05:30, no DST). called_at is a UTC TIMESTAMP, so we CONVERT_TZ to
    // IST for both bucketing and "today"/"now". Buckets are counted straight from
    // the call records and NEVER go past the current hour (no future bars). With
    // no date range the chart shows *today* (IST); a range buckets across it and
    // is still capped at the current hour when the range reaches today.
    const IST = "+05:30";
    let hWhere = "WHERE 1=1";
    const hParams = [];
    if (date_from) { hWhere += ` AND DATE(CONVERT_TZ(c.called_at,'+00:00','${IST}')) >= ?`; hParams.push(date_from); }
    if (date_to)   { hWhere += ` AND DATE(CONVERT_TZ(c.called_at,'+00:00','${IST}')) <= ?`; hParams.push(date_to); }
    if (!date_from && !date_to) {
      hWhere += ` AND DATE(CONVERT_TZ(c.called_at,'+00:00','${IST}')) = DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','${IST}'))`;
    }
    const hourRows = await query(
      `SELECT HOUR(CONVERT_TZ(c.called_at,'+00:00','${IST}')) AS h, COUNT(*) AS n
         FROM calls c ${hWhere} GROUP BY h`,
      hParams
    );
    const [nowIST] = await query(
      `SELECT HOUR(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','${IST}')) AS cur_hour,
              DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','${IST}')) AS today`
    );
    const curHour = Number(nowIST?.cur_hour ?? 23);
    // Cap at the current hour only when the view includes today; a purely
    // historical range shows all 24 hours (they have all already elapsed).
    const includesToday = !date_to || String(date_to) >= String(nowIST?.today ?? "");
    const maxHour = includesToday ? curHour : 23;
    const counts = {};
    hourRows.forEach((r) => { counts[Number(r.h)] = Number(r.n); });
    const hourly = [];
    for (let h = 0; h <= maxHour; h++) hourly.push({ hour: h, calls: counts[h] || 0 });

    // Daily timeline
    const byDate = {};
    calls.forEach((c) => {
      const d = new Date(c.called_at).toISOString().slice(0, 10);
      byDate[d] = (byDate[d] || 0) + 1;
    });
    const timeline = Object.entries(byDate)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Best caller — only count actual callers, not admin/supervisor accounts
    const CALLER_ROLE_VALUES = ["caller", "user", "agent"];
    const perAgent = {};
    calls.forEach((c) => {
      if (!c.agent_name) return;
      if (!CALLER_ROLE_VALUES.includes(c.agent_role)) return;
      perAgent[c.agent_name] = (perAgent[c.agent_name] || 0) + 1;
    });
    const bestCaller = Object.entries(perAgent).sort((a, b) => b[1] - a[1])[0];

    return Response.json({
      tally,
      hourly,
      timeline,
      best_caller: bestCaller ? { name: bestCaller[0], calls: bestCaller[1] } : null,
    });
  } catch (err) {
    console.error("supervisor/summary error:", err);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
