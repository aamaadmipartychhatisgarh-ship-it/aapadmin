import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureConferenceSchema, normalizeSpokespersonIds } from "@/lib/conferenceSchema";

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensureConferenceSchema();
    const d = await req.json();
    if (!d.title || !d.conference_date) return NextResponse.json({ message: "Title and date required" }, { status: 400 });
    // Multiple spokespersons (§10.1): accept an array or CSV of ids, keep only
    // valid numeric ids, and store as CSV. spokesperson_id mirrors the FIRST id
    // so existing single-spokesperson reads keep working.
    const ids = normalizeSpokespersonIds(d.spokesperson_ids ?? d.spokesperson_id);
    const spokespersonIdsCsv = ids.length ? ids.join(",") : null;
    const spokespersonId = ids.length ? ids[0] : null;
    const coSpokesperson = d.co_spokesperson ? String(d.co_spokesperson).trim().slice(0, 255) || null : null;
    const videoUrl = d.video_url ? String(d.video_url).trim() : null;
    const res = await query(
      `INSERT INTO press_conferences (title, conference_date, venue, agenda, status, file_url, spokesperson_id, spokesperson_ids, co_spokesperson, video_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.title, d.conference_date, d.venue || null, d.agenda || null, d.status || "scheduled", d.file_url || null, spokespersonId, spokespersonIdsCsv, coSpokesperson, videoUrl]
    );
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("conferences POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
