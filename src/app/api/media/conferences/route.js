import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureConferenceSchema } from "@/lib/conferenceSchema";
import { createWithSpokespersonNumber, spokespersonForNumber } from "@/lib/spokespersonNumber";

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensureConferenceSchema();
    const d = await req.json();
    if (!d.title || !d.conference_date) return NextResponse.json({ message: "Title and date required" }, { status: 400 });
    const coSpokesperson = d.co_spokesperson ? String(d.co_spokesperson).trim().slice(0, 255) || null : null;
    const videoUrl = d.video_url ? String(d.video_url).trim() : null;
    // Spokesperson is assigned AUTOMATICALLY in sequence (§3) — the entry's
    // backend-allocated number maps to the next spokesperson in the active master
    // (round-robin). Any client-supplied spokesperson is ignored: the user no
    // longer picks one. spokesperson_id and the legacy CSV both hold the single
    // auto-assigned id so existing reads keep working.
    const { res, number } = await createWithSpokespersonNumber("press_conferences", async (spokesNum) => {
      const assignedId = await spokespersonForNumber(spokesNum);
      const csv = assignedId != null ? String(assignedId) : null;
      return query(
        `INSERT INTO press_conferences (title, conference_date, venue, agenda, status, file_url, spokesperson_id, spokesperson_ids, co_spokesperson, video_url, spokesperson_number)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [d.title, d.conference_date, d.venue || null, d.agenda || null, d.status || "scheduled", d.file_url || null, assignedId, csv, coSpokesperson, videoUrl, spokesNum]
      );
    });
    return NextResponse.json({ id: res.insertId, spokesperson_number: number }, { status: 201 });
  } catch (err) {
    console.error("conferences POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
