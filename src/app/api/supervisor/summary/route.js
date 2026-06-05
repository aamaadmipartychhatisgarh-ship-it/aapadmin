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

    // Hourly buckets (today only if no range)
    const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, calls: 0 }));
    calls.forEach((c) => {
      const h = new Date(c.called_at).getHours();
      hourly[h].calls++;
    });

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
