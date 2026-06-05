import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    // Latest snapshot per platform (totals) + 30-day trend.
    const latest = await query(
      `SELECT s.platform, s.views, s.reach, s.followers, s.engagement, s.viral_posts
         FROM social_analytics s
         INNER JOIN (SELECT platform, MAX(metric_date) AS d FROM social_analytics GROUP BY platform) m
           ON m.platform = s.platform AND m.d = s.metric_date`
    );
    const trend = await query(
      `SELECT metric_date, platform, views, reach, engagement
         FROM social_analytics
        WHERE metric_date >= CURDATE() - INTERVAL 29 DAY
        ORDER BY metric_date ASC`
    );
    const [[totals]] = await query(
      `SELECT SUM(followers) AS followers, SUM(views) AS views, SUM(reach) AS reach, SUM(viral_posts) AS viral
         FROM social_analytics s
         INNER JOIN (SELECT platform, MAX(metric_date) AS d FROM social_analytics GROUP BY platform) m
           ON m.platform = s.platform AND m.d = s.metric_date`
    ).then((r) => [r]);

    return NextResponse.json({ latest, trend, totals });
  } catch (err) {
    console.error("social error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
