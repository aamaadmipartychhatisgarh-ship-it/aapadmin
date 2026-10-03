import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/media/sentiment?days=30 — coverage sentiment analytics over a recent
// window: overall positive / neutral / negative counts and the per-newspaper
// breakdown, read from press_notes.sentiment (the published-coverage table). The
// sentiment column is feature-detected so this is a safe no-op on an un-migrated
// database rather than a 500.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "media", session && canAccessMedia(session))))
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const days = Math.min(365, Math.max(1, parseInt(new URL(req.url).searchParams.get("days") || "30", 10) || 30));
    const hasSentiment = (await query("SHOW COLUMNS FROM press_notes LIKE 'sentiment'").catch(() => [])).length > 0;
    if (!hasSentiment) {
      return NextResponse.json({ days, available: false, counts: { total: 0, positive: 0, neutral: 0, negative: 0 }, byNewspaper: [] });
    }

    const num = (v) => Number(v) || 0;
    const [[row]] = await query(
      `SELECT COUNT(*) AS total,
              SUM(sentiment = 'positive') AS positive,
              SUM(sentiment = 'neutral')  AS neutral,
              SUM(sentiment = 'negative') AS negative
         FROM press_notes
        WHERE coverage_date >= (CURDATE() - INTERVAL ? DAY)`,
      [days]
    ).then((r) => [r]);
    const byNewspaper = await query(
      `SELECT n.name AS newspaper,
              COUNT(*) AS total,
              SUM(p.sentiment = 'positive') AS positive,
              SUM(p.sentiment = 'neutral')  AS neutral,
              SUM(p.sentiment = 'negative') AS negative
         FROM press_notes p JOIN newspapers n ON n.id = p.newspaper_id
        WHERE p.coverage_date >= (CURDATE() - INTERVAL ? DAY)
        GROUP BY n.id, n.name
        HAVING total > 0
        ORDER BY positive DESC, total DESC
        LIMIT 12`,
      [days]
    );

    return NextResponse.json({
      days,
      available: true,
      counts: { total: num(row.total), positive: num(row.positive), neutral: num(row.neutral), negative: num(row.negative) },
      byNewspaper: byNewspaper.map((r) => ({
        newspaper: r.newspaper, total: num(r.total), positive: num(r.positive), neutral: num(r.neutral), negative: num(r.negative),
      })),
    });
  } catch (e) {
    console.error("[media/sentiment] GET:", e?.message || e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
