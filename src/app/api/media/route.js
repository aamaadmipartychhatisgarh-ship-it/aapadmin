import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensurePressNotesSchema } from "@/lib/pressNotesSchema";
import { ensureNewsChannelsSeed } from "@/lib/newsChannelsSeed";
import { ensureConferenceSchema } from "@/lib/conferenceSchema";
import { mediaDateFilter } from "@/lib/mediaDateFilter";

// Aggregated GET for the Media hub page.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    // Global Media Center date filter — applied to every date-based section
    // (coverage / debates / conferences + their analytics) against the real DB
    // date columns. When no range is selected ("all"), each section keeps its
    // own default window so existing behaviour is preserved.
    const { searchParams } = new URL(req.url);
    const time = searchParams.get("time") || "all";
    const dateFrom = searchParams.get("from") || "";
    const dateTo = searchParams.get("to") || "";
    const noteFilter = mediaDateFilter("pn.coverage_date", time, dateFrom, dateTo);
    const covFilter = mediaDateFilter("coverage_date", time, dateFrom, dateTo);
    const debFilter = mediaDateFilter("d.debate_date", time, dateFrom, dateTo);
    const confFilter = mediaDateFilter("pc.conference_date", time, dateFrom, dateTo);
    const active = !!noteFilter.range;
    const listLimit = active ? 200 : 30;

    // Widen the press-note `kind` column (once) and seed the master newspaper
    // list so the dropdown is populated on first load.
    await ensurePressNotesSchema();
    await ensureNewsChannelsSeed();
    await ensureConferenceSchema();
    const newspapers = await query(`SELECT * FROM newspapers ORDER BY sort_order, name`);

    // Per-newspaper positive / negative coverage counts — the SAME source of
    // truth (press_notes.sentiment keyed by newspaper_id) that the Analytics
    // tab and the Reports press_notes module use. The date filter sits in the
    // LEFT JOIN's ON clause so EVERY newspaper is returned (including ones with
    // zero coverage in range → 0/0), and press_notes→newspaper is many-to-one
    // so each coverage row is counted exactly once (no duplicate counting).
    const newspaperStats = await query(
      `SELECT np.id, np.name, np.lok_sabha_id, np.lok_sabha_all, ls.name AS lok_sabha_name,
              COALESCE(SUM(pn.sentiment = 'positive'), 0) AS positive,
              COALESCE(SUM(pn.sentiment = 'negative'), 0) AS negative,
              COUNT(pn.id) AS total
         FROM newspapers np
         LEFT JOIN locations ls ON ls.id = np.lok_sabha_id AND ls.type = 'lok_sabha'
         LEFT JOIN press_notes pn ON pn.newspaper_id = np.id${noteFilter.clause}
        GROUP BY np.id, np.name, np.lok_sabha_id, np.lok_sabha_all, ls.name
        ORDER BY np.sort_order, np.name`,
      noteFilter.params
    );

    const channels = await query(`SELECT * FROM news_channels ORDER BY sort_order, name`);
    const spokespersons = await query(`SELECT * FROM spokespersons ORDER BY name`);
    const journalists = await query(`SELECT * FROM journalists ORDER BY name`);

    const recentNotes = await query(
      `SELECT pn.*, np.name AS newspaper_name
         FROM press_notes pn LEFT JOIN newspapers np ON np.id = pn.newspaper_id
        WHERE 1=1${noteFilter.clause}
        ORDER BY pn.coverage_date DESC, pn.id DESC LIMIT ${listLimit}`,
      noteFilter.params
    );

    // Default view shows upcoming debates (from a week ago onward); a date filter
    // instead shows exactly the selected range (past included), newest first.
    const debWhere = debFilter.clause
      ? `WHERE 1=1${debFilter.clause}`
      : `WHERE d.debate_date >= CURDATE() - INTERVAL 7 DAY`;
    const upcomingDebates = await query(
      `SELECT d.*, c.name AS channel_name,
              (SELECT COUNT(*) FROM debate_assignments da WHERE da.debate_id = d.id) AS assignee_count
         FROM debates d LEFT JOIN news_channels c ON c.id = d.channel_id
        ${debWhere}
        ORDER BY d.debate_date ${debFilter.clause ? "DESC" : "ASC"}, d.debate_time ASC LIMIT ${listLimit}`,
      debFilter.params
    );
    // Attach the assigned spokespersons (id + name) to each debate so the edit
    // form can pre-select them and the list can show the names. One grouped
    // query, not an N+1 loop.
    const debateIds = upcomingDebates.map((d) => d.id);
    const byDebate = {};
    if (debateIds.length) {
      const daRows = await query(
        `SELECT da.debate_id, s.id, s.name
           FROM debate_assignments da JOIN spokespersons s ON s.id = da.spokesperson_id
          WHERE da.debate_id IN (${debateIds.map(() => "?").join(",")})
          ORDER BY s.name`,
        debateIds
      );
      for (const r of daRows) (byDebate[r.debate_id] ||= []).push({ id: r.id, name: r.name });
    }
    for (const d of upcomingDebates) d.spokespersons = byDebate[d.id] || [];

    const confWhere = confFilter.clause
      ? `WHERE 1=1${confFilter.clause}`
      : `WHERE pc.conference_date >= NOW() - INTERVAL 30 DAY`;
    const conferences = await query(
      `SELECT pc.*,
              (SELECT COUNT(*) FROM journalist_invites ji WHERE ji.conference_id = pc.id) AS invited,
              (SELECT COUNT(*) FROM journalist_invites ji WHERE ji.conference_id = pc.id AND ji.attended = 1) AS attended
         FROM press_conferences pc
        ${confWhere}
        ORDER BY pc.conference_date ${confFilter.clause ? "DESC" : "ASC"} LIMIT ${listLimit}`,
      confFilter.params
    );

    // Analytics: coverage count, channel tone breakdown, top topics, top
    // spokesperson — all responding to the SAME date filter (default: 30 days).
    const covWhere = covFilter.clause
      ? `WHERE 1=1${covFilter.clause}`
      : `WHERE coverage_date >= CURDATE() - INTERVAL 30 DAY`;
    const [[counts]] = await query(
      `SELECT COUNT(*) AS coverage_total,
              SUM(sentiment='positive') AS positive,
              SUM(sentiment='neutral') AS neutral,
              SUM(sentiment='negative') AS negative
         FROM press_notes ${covWhere}`,
      covFilter.params
    ).then((r) => [r]);

    // Channel tone list — every channel from the master (item 1), its stored
    // tone, and the number of debates it actually hosted in the selected range
    // (from the debates records, so the tone label is backed by real data and
    // refreshes with the date filter). GROUP BY channel id → one row per channel
    // (no duplicates); the date filter sits in the LEFT JOIN ON clause so every
    // channel appears even with zero in-range debates. Consistent with the
    // debate status cards, which classify a debate by this same channel tone.
    const channelTone = await query(
      `SELECT ch.id, ch.name, ch.tone, COUNT(d.id) AS debates
         FROM news_channels ch
         LEFT JOIN debates d ON d.channel_id = ch.id${debFilter.clause}
        GROUP BY ch.id, ch.name, ch.tone
        ORDER BY ch.sort_order, ch.name`,
      debFilter.params
    );

    // Top spokespersons by viral score across debates in the selected range
    // (when a filter is active); otherwise across all debates. The date filter
    // sits in the debates join ON clause and we COUNT/SUM the matched debate rows
    // so out-of-range debates don't count (a spokesperson with no in-range debate
    // still lists with 0). COUNT(d.id) == COUNT(da.id) when unfiltered (every
    // assignment has a debate), so the default view is unchanged.
    const topSpokespersons = await query(
      `SELECT s.id, s.name, COUNT(d.id) AS debates,
              COALESCE(SUM(d.viral_score), 0) AS total_viral
         FROM spokespersons s
         LEFT JOIN debate_assignments da ON da.spokesperson_id = s.id
         LEFT JOIN debates d ON d.id = da.debate_id${debFilter.clause}
        GROUP BY s.id, s.name
        ORDER BY total_viral DESC, debates DESC LIMIT 5`,
      debFilter.params
    );

    // Debate status cards — computed from the ACTUAL debates records in one pass
    // (each debate counted once; the channel join is many-to-one so no
    // fan-out/duplicates), respecting the date filter on d.debate_date:
    //   • total     — every debate scheduled onto the calendar (all statuses)
    //   • done      — status = 'aired' (the debate's "completed/done" state)
    //   • positive/neutral/negative — the debate's tone, taken from its news
    //     channel's stored tone (supportive → positive, neutral → neutral,
    //     opposing → negative). unknown / no channel is left unclassified. This
    //     is the same tone model the Channel Tone card already uses.
    const [dbg] = await query(
      `SELECT
          COUNT(*) AS total,
          COALESCE(SUM(d.status = 'aired'), 0) AS done,
          COALESCE(SUM(ch.tone = 'supportive'), 0) AS positive,
          COALESCE(SUM(ch.tone = 'neutral'), 0) AS neutral,
          COALESCE(SUM(ch.tone = 'opposing'), 0) AS negative
         FROM debates d
         LEFT JOIN news_channels ch ON ch.id = d.channel_id
        WHERE 1=1${debFilter.clause}`,
      debFilter.params
    );
    const debateStats = {
      total: Number(dbg?.total) || 0,
      done: Number(dbg?.done) || 0,
      positive: Number(dbg?.positive) || 0,
      neutral: Number(dbg?.neutral) || 0,
      negative: Number(dbg?.negative) || 0,
    };

    return NextResponse.json({
      newspapers, newspaperStats, channels, spokespersons, journalists,
      recentNotes, upcomingDebates, conferences,
      analytics: { counts, channelTone, topSpokespersons, debateStats },
    });
  } catch (err) {
    console.error("media GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
