import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";
import { resolveRange } from "@/lib/reports/timeRanges";
import { mediaDateFilter } from "@/lib/mediaDateFilter";
import { ensureConferenceSchema } from "@/lib/conferenceSchema";

export const dynamic = "force-dynamic";

// GET /api/media/dashboard/day?date=YYYY-MM-DD — the Media Dashboard's daily
// report: the ACTUAL newspaper / press-conference / debate records for ONE
// calendar day. With no ?date, it defaults to YESTERDAY computed in the app's
// configured timezone (Asia/Kolkata via resolveRange), so the dashboard opens on
// the previous calendar day — never today or two days ago. The resolved date is
// echoed back so the client can initialise its date control to it.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensureConferenceSchema();

    const { searchParams } = new URL(req.url);
    const param = searchParams.get("date");
    // Default = yesterday (IST). A provided date must be a valid YYYY-MM-DD.
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(param || "")) ? param : resolveRange("yesterday").from;

    // Same date-column semantics as the rest of the Media Center (a single IST
    // day → [date 00:00, next-day 00:00)), so all sections agree on "this day".
    const npF = mediaDateFilter("pn.coverage_date", "custom", date, date);
    const debF = mediaDateFilter("de.debate_date", "custom", date, date);
    const confF = mediaDateFilter("pc.conference_date", "custom", date, date);

    // Section 1 — Newspaper coverage: Title, Brief, Newspaper Name.
    const newspapers = await query(
      `SELECT pn.id, pn.title, pn.summary, np.name AS newspaper_name
         FROM press_notes pn
         LEFT JOIN newspapers np ON np.id = pn.newspaper_id
        WHERE 1=1${npF.clause}
        ORDER BY pn.coverage_date DESC, pn.id DESC`,
      npF.params
    );

    // Section 2 — Press Conferences: Title, Spokesperson, status (Done = completed).
    const conferences = await query(
      `SELECT pc.id, pc.title, pc.status, sp.name AS spokesperson_name, sp.photo_url AS spokesperson_photo
         FROM press_conferences pc
         LEFT JOIN spokespersons sp ON sp.id = pc.spokesperson_id
        WHERE pc.status <> 'cancelled'${confF.clause}
        ORDER BY pc.conference_date ASC, pc.id ASC`,
      confF.params
    );

    // Section 3 — News Channel debates: Channel Name, Title, Spokespersons.
    const debates = await query(
      `SELECT de.id, de.topic, de.status, c.name AS channel_name
         FROM debates de
         LEFT JOIN news_channels c ON c.id = de.channel_id
        WHERE de.status <> 'cancelled'${debF.clause}
        ORDER BY de.debate_date ASC, de.debate_time ASC, de.id ASC`,
      debF.params
    );
    // Attach each debate's spokespersons (name + photo) in one grouped query.
    const debateIds = debates.map((d) => d.id);
    if (debateIds.length) {
      const rows = await query(
        `SELECT da.debate_id, s.name, s.photo_url
           FROM debate_assignments da JOIN spokespersons s ON s.id = da.spokesperson_id
          WHERE da.debate_id IN (${debateIds.map(() => "?").join(",")})`,
        debateIds
      );
      const byDebate = {};
      for (const r of rows) (byDebate[r.debate_id] ||= []).push({ name: r.name, photo_url: r.photo_url });
      for (const d of debates) d.spokespersons = byDebate[d.id] || [];
    } else {
      for (const d of debates) d.spokespersons = [];
    }

    return NextResponse.json({ date, newspapers, conferences, debates });
  } catch (err) {
    console.error("media dashboard day error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
