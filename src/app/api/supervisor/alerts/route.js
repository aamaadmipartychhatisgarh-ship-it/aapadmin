import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { query } from "@/lib/db";

// Rule-based alerts derived from today's data.
// Rules:
//   - low_activity: caller online but <5 calls in last hour
//   - high_wrong:   >25% wrong-number rate for a caller today (min 10 calls)
//   - rejection:    >=3 'Rudely Behaved' or 'opponent' sentiment calls in last hour
//   - pending_fu:   >0 follow-ups overdue (follow_up_date < today)
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisor(session)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const alerts = [];

    // Wrong-number rate (today) — only flag actual callers
    const wrongRows = await query(
      `SELECT u.id AS user_id, u.username,
              COUNT(c.id) AS total,
              SUM(CASE WHEN cs.name = 'Wrong Number' THEN 1 ELSE 0 END) AS wrong
         FROM users u
         JOIN calls c ON c.user_id = u.id
         LEFT JOIN call_statuses cs ON cs.id = c.status_id
        WHERE DATE(c.called_at) = CURDATE()
          AND u.role IN ('caller','user','agent')
        GROUP BY u.id, u.username
       HAVING total >= 10 AND wrong / total > 0.25`
    );
    wrongRows.forEach((r) => {
      alerts.push({
        type: "high_wrong",
        severity: "warning",
        user_id: r.user_id,
        message: `${r.username}: ${r.wrong}/${r.total} wrong-number calls today (${Math.round(r.wrong / r.total * 100)}%)`,
      });
    });

    // Rude behaviour (last hour) — callers only
    const rudeRows = await query(
      `SELECT u.id AS user_id, u.username, COUNT(c.id) AS rude
         FROM users u
         JOIN calls c ON c.user_id = u.id
         JOIN call_statuses cs ON cs.id = c.status_id
        WHERE cs.name = 'Rudely Behaved'
          AND c.called_at >= NOW() - INTERVAL 1 HOUR
          AND u.role IN ('caller','user','agent')
        GROUP BY u.id, u.username
       HAVING rude >= 3`
    );
    rudeRows.forEach((r) => {
      alerts.push({
        type: "rejection",
        severity: "warning",
        user_id: r.user_id,
        message: `${r.username}: ${r.rude} rude/rejection calls in the last hour`,
      });
    });

    // Overdue follow-ups
    const [overdue] = await query(
      `SELECT COUNT(*) AS n FROM calls
        WHERE is_follow_up_required = 1
          AND follow_up_date IS NOT NULL
          AND follow_up_date < CURDATE()`
    );
    if (overdue && overdue.n > 0) {
      alerts.push({
        type: "pending_fu",
        severity: "info",
        message: `${overdue.n} follow-up(s) are past their scheduled date`,
      });
    }

    // Low activity: callers who have been seen recently but logged fewer than 5 calls today
    const idleRows = await query(
      `SELECT u.id AS user_id, u.username,
              (SELECT COUNT(*) FROM calls WHERE user_id = u.id AND DATE(called_at) = CURDATE()) AS today_calls
         FROM users u
        WHERE u.role IN ('caller','user','agent')
          AND u.last_seen_at >= NOW() - INTERVAL 10 MINUTE
       HAVING today_calls < 5`
    );
    idleRows.forEach((r) => {
      alerts.push({
        type: "low_activity",
        severity: "info",
        user_id: r.user_id,
        message: `${r.username} is online but has only ${r.today_calls} calls today`,
      });
    });

    return Response.json({ alerts });
  } catch (err) {
    console.error("supervisor/alerts error:", err);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
