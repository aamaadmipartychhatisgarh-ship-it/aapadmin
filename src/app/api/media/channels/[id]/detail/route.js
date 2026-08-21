import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureNewsChannelsSeed } from "@/lib/newsChannelsSeed";

export const dynamic = "force-dynamic";

// GET /api/media/channels/[id]/detail — one channel's full detail, loaded by
// channel ID (never by name): the channel (name, tone, Lok Sabha) and every
// debate scheduled on it, each with its assigned spokespersons. Existing debate
// records are only read here.
export async function GET(_req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensureNewsChannelsSeed();
    const { id } = await params;
    if (!/^\d+$/.test(String(id))) return NextResponse.json({ message: "Invalid channel id." }, { status: 400 });

    const [channel] = await query(
      `SELECT nc.id, nc.name, nc.tone, nc.lok_sabha_id, ls.name AS lok_sabha_name
         FROM news_channels nc
         LEFT JOIN locations ls ON ls.id = nc.lok_sabha_id AND ls.type = 'lok_sabha'
        WHERE nc.id = ?`,
      [id]
    );
    if (!channel) return NextResponse.json({ message: "Channel not found." }, { status: 404 });

    const debates = await query(
      `SELECT d.*, c.name AS channel_name
         FROM debates d LEFT JOIN news_channels c ON c.id = d.channel_id
        WHERE d.channel_id = ?
        ORDER BY d.debate_date DESC, d.debate_time DESC, d.id DESC`,
      [id]
    );
    const debateIds = debates.map((d) => d.id);
    if (debateIds.length) {
      const rows = await query(
        `SELECT da.debate_id, s.id, s.name, s.photo_url
           FROM debate_assignments da JOIN spokespersons s ON s.id = da.spokesperson_id
          WHERE da.debate_id IN (${debateIds.map(() => "?").join(",")})`,
        debateIds
      );
      const byDebate = {};
      for (const r of rows) (byDebate[r.debate_id] ||= []).push({ id: r.id, name: r.name, photo_url: r.photo_url });
      for (const d of debates) d.spokespersons = byDebate[d.id] || [];
    } else {
      for (const d of debates) d.spokespersons = [];
    }

    return NextResponse.json({ channel: { ...channel, lok_sabha_name: channel.lok_sabha_name || null }, debates });
  } catch (err) {
    console.error("channel detail GET error:", err);
    return NextResponse.json({ message: "Failed to load the channel." }, { status: 500 });
  }
}
