import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureConferenceSchema } from "@/lib/conferenceSchema";

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensureConferenceSchema();
    const d = await req.json();
    if (!d.title || !d.conference_date) return NextResponse.json({ message: "Title and date required" }, { status: 400 });
    const spokespersonId = d.spokesperson_id != null && /^\d+$/.test(String(d.spokesperson_id)) ? Number(d.spokesperson_id) : null;
    const res = await query(
      `INSERT INTO press_conferences (title, conference_date, venue, agenda, status, file_url, spokesperson_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [d.title, d.conference_date, d.venue || null, d.agenda || null, d.status || "scheduled", d.file_url || null, spokespersonId]
    );
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("conferences POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
