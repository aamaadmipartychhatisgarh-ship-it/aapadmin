import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureNewsChannelsSeed } from "@/lib/newsChannelsSeed";
import { createWithSpokespersonNumber } from "@/lib/spokespersonNumber";

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensureNewsChannelsSeed(); // ensures debates.lok_sabha_id exists (BUG 23)
    const d = await req.json();
    if (!d.topic || !d.debate_date) return NextResponse.json({ message: "Topic and date required" }, { status: 400 });
    // Channel comes from the channel the Schedule Debate was opened from (id, not
    // name); Lok Sabha from the Master dropdown. Both stored as IDs (§5/§6).
    const channelId = d.channel_id ? Number(d.channel_id) : null;
    const lokSabhaId = d.lok_sabha_id ? Number(d.lok_sabha_id) : null;
    // The spokesperson number is assigned by the backend (lowest available,
    // concurrency-safe) — any client-supplied value is ignored (§13, §19).
    const { res, number } = await createWithSpokespersonNumber("debates", (spokesNum) =>
      query(
        `INSERT INTO debates (channel_id, lok_sabha_id, topic, debate_date, debate_time, brief_pdf_url, talking_points, opposition_counter, status, spokesperson_number)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [channelId, lokSabhaId, d.topic, d.debate_date, d.debate_time || null,
         d.brief_pdf_url || null, d.talking_points || null, d.opposition_counter || null,
         d.status || "scheduled", spokesNum]
      )
    );
    // Optional: assign spokespersons in same request
    if (Array.isArray(d.spokesperson_ids)) {
      for (const sid of d.spokesperson_ids) {
        await query(`INSERT IGNORE INTO debate_assignments (debate_id, spokesperson_id) VALUES (?, ?)`, [res.insertId, sid]);
      }
    }
    return NextResponse.json({ id: res.insertId, spokesperson_number: number }, { status: 201 });
  } catch (err) {
    console.error("debates POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
