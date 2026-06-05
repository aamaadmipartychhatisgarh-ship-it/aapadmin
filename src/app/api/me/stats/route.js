import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const [today] = await query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN cs.name = 'Phone Picked' THEN 1 ELSE 0 END) AS connected,
              SUM(CASE WHEN c.is_follow_up_required = 1 THEN 1 ELSE 0 END) AS follow_ups,
              SUM(CASE WHEN c.sentiment IN ('positive','supporter') THEN 1 ELSE 0 END) AS interested
         FROM calls c
         LEFT JOIN call_statuses cs ON cs.id = c.status_id
        WHERE c.user_id = ? AND DATE(c.called_at) = CURDATE()`,
      [userId]
    );

    const week = await query(
      `SELECT DATE(called_at) AS day, COUNT(*) AS calls
         FROM calls
        WHERE user_id = ?
          AND called_at >= CURDATE() - INTERVAL 6 DAY
        GROUP BY DATE(called_at)
        ORDER BY day ASC`,
      [userId]
    );

    const sentimentRows = await query(
      `SELECT sentiment, COUNT(*) AS n
         FROM calls
        WHERE user_id = ? AND sentiment IS NOT NULL
        GROUP BY sentiment`,
      [userId]
    );
    const sentiment = { positive: 0, supporter: 0, neutral: 0, negative: 0, opponent: 0 };
    sentimentRows.forEach((r) => { sentiment[r.sentiment] = Number(r.n) || 0; });

    // Rank among standard callers by today's total calls
    const ranking = await query(
      `SELECT u.id, COUNT(c.id) AS n
         FROM users u
         LEFT JOIN calls c ON c.user_id = u.id AND DATE(c.called_at) = CURDATE()
        WHERE u.role IN ('caller','user','agent')
        GROUP BY u.id
        ORDER BY n DESC`
    );
    const myRank = ranking.findIndex((r) => String(r.id) === String(userId)) + 1;
    const teamSize = ranking.length;

    return NextResponse.json({
      today: {
        total: Number(today?.total || 0),
        connected: Number(today?.connected || 0),
        follow_ups: Number(today?.follow_ups || 0),
        interested: Number(today?.interested || 0),
      },
      week,
      sentiment,
      rank: { position: myRank || null, team_size: teamSize },
    });
  } catch (err) {
    console.error("me/stats error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
