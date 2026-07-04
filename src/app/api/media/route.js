import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";

// Aggregated GET for the Media hub page.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const newspapers = await query(`SELECT * FROM newspapers ORDER BY sort_order, name`);
    const channels = await query(`SELECT * FROM news_channels ORDER BY sort_order, name`);
    const spokespersons = await query(`SELECT * FROM spokespersons ORDER BY name`);
    const journalists = await query(`SELECT * FROM journalists ORDER BY name`);

    const recentNotes = await query(
      `SELECT pn.*, np.name AS newspaper_name
         FROM press_notes pn LEFT JOIN newspapers np ON np.id = pn.newspaper_id
        ORDER BY pn.coverage_date DESC, pn.id DESC LIMIT 30`
    );

    const upcomingDebates = await query(
      `SELECT d.*, c.name AS channel_name,
              (SELECT COUNT(*) FROM debate_assignments da WHERE da.debate_id = d.id) AS assignee_count
         FROM debates d LEFT JOIN news_channels c ON c.id = d.channel_id
        WHERE d.debate_date >= CURDATE() - INTERVAL 7 DAY
        ORDER BY d.debate_date ASC, d.debate_time ASC LIMIT 30`
    );

    const conferences = await query(
      `SELECT pc.*,
              (SELECT COUNT(*) FROM journalist_invites ji WHERE ji.conference_id = pc.id) AS invited,
              (SELECT COUNT(*) FROM journalist_invites ji WHERE ji.conference_id = pc.id AND ji.attended = 1) AS attended
         FROM press_conferences pc
        WHERE pc.conference_date >= NOW() - INTERVAL 30 DAY
        ORDER BY pc.conference_date ASC LIMIT 30`
    );

    // Analytics: coverage count, channel tone breakdown, top topics, top spokesperson
    const [[counts]] = await query(
      `SELECT COUNT(*) AS coverage_total,
              SUM(sentiment='positive') AS positive,
              SUM(sentiment='neutral') AS neutral,
              SUM(sentiment='negative') AS negative
         FROM press_notes WHERE coverage_date >= CURDATE() - INTERVAL 30 DAY`
    ).then((r) => [r]);

    const channelTone = await query(`SELECT tone, COUNT(*) AS n FROM news_channels GROUP BY tone`);

    const topSpokespersons = await query(
      `SELECT s.id, s.name, COUNT(da.id) AS debates,
              COALESCE(SUM(d.viral_score), 0) AS total_viral
         FROM spokespersons s
         LEFT JOIN debate_assignments da ON da.spokesperson_id = s.id
         LEFT JOIN debates d ON d.id = da.debate_id
        GROUP BY s.id, s.name
        ORDER BY total_viral DESC, debates DESC LIMIT 5`
    );

    return NextResponse.json({
      newspapers, channels, spokespersons, journalists,
      recentNotes, upcomingDebates, conferences,
      analytics: { counts, channelTone, topSpokespersons },
    });
  } catch (err) {
    console.error("media GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
