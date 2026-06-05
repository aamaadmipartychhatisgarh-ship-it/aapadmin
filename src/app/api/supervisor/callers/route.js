import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { query } from "@/lib/db";

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisor(session)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const date_from = searchParams.get("date_from");
    const date_to = searchParams.get("date_to");

    // Date filter is applied as part of the LEFT JOIN's ON clause so users
    // with zero calls in the range still appear.
    const params = [];
    let joinExtra = "";
    if (date_from) { joinExtra += " AND DATE(c.called_at) >= ?"; params.push(date_from); }
    if (date_to)   { joinExtra += " AND DATE(c.called_at) <= ?"; params.push(date_to); }

    const rows = await query(
      `SELECT
         u.id AS user_id,
         u.username AS name,
         u.role,
         u.last_seen_at,
         COUNT(c.id) AS total_calls,
         SUM(CASE WHEN cs.name = 'Phone Picked' THEN 1 ELSE 0 END) AS connected,
         SUM(CASE WHEN cs.name = 'Not Picked' THEN 1 ELSE 0 END) AS no_answer,
         SUM(CASE WHEN cs.name = 'Wrong Number' THEN 1 ELSE 0 END) AS wrong_number,
         SUM(CASE WHEN cs.name = 'Rudely Behaved' THEN 1 ELSE 0 END) AS rejected,
         SUM(CASE WHEN cs.name = 'Busy' THEN 1 ELSE 0 END) AS busy,
         SUM(CASE WHEN cs.name = 'Switched Off' THEN 1 ELSE 0 END) AS switched_off,
         ROUND(AVG(c.duration_seconds), 0) AS avg_duration_seconds,
         SUM(CASE WHEN c.is_follow_up_required = 1 THEN 1 ELSE 0 END) AS pending_follow_ups,
         SUM(CASE WHEN c.sentiment IN ('positive','supporter') THEN 1 ELSE 0 END) AS interested
       FROM users u
       LEFT JOIN calls c ON c.user_id = u.id ${joinExtra}
       LEFT JOIN call_statuses cs ON cs.id = c.status_id
       WHERE u.role IN ('caller', 'user', 'agent')
       GROUP BY u.id, u.username, u.role, u.last_seen_at
       ORDER BY total_calls DESC`,
      params
    );

    const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));
    return Response.json({ callers: ranked });
  } catch (err) {
    console.error("supervisor/callers error:", err);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
