import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureConferenceSchema } from "@/lib/conferenceSchema";

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensureConferenceSchema();
    const { id } = await params;
    const d = await req.json();
    // Only fields present in the payload are written (partial-update safe), so
    // e.g. uploading the video after the conference is Done never blanks its
    // spokespersons or agenda.
    // The spokesperson is assigned automatically in sequence at creation (§3) and
    // is NOT edited here — any spokesperson field in the payload is ignored so an
    // edit can never wipe or change the auto-assignment.
    const fields = ["title", "conference_date", "venue", "agenda", "status", "file_url", "co_spokesperson", "video_url"];
    const sets = [], vals = [];
    for (const f of fields) if (f in d) { sets.push(`${f} = ?`); vals.push(d[f] === "" ? null : d[f]); }
    if (!sets.length) return NextResponse.json({ message: "No fields" }, { status: 400 });
    vals.push(id);
    await query(`UPDATE press_conferences SET ${sets.join(", ")} WHERE id = ?`, vals);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("conference PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    await query("DELETE FROM press_conferences WHERE id = ?", [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("conference DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
