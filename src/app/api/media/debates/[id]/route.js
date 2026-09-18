import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const d = await req.json();
    // The spokesperson is assigned automatically in sequence at creation (§3) and
    // is NOT edited here — any spokesperson_ids in the payload is ignored so an
    // edit can never change the auto-assignment.
    const fields = ["channel_id", "lok_sabha_id", "topic", "debate_date", "debate_time", "brief_pdf_url", "talking_points", "opposition_counter", "status", "viral_score"];
    const sets = [], vals = [];
    for (const f of fields) if (f in d) { sets.push(`${f} = ?`); vals.push(d[f] === "" ? null : d[f]); }
    if (!sets.length) return NextResponse.json({ message: "No changes to save." }, { status: 400 });
    vals.push(id);
    await query(`UPDATE debates SET ${sets.join(", ")} WHERE id = ?`, vals);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("debate PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    await query("DELETE FROM debates WHERE id = ?", [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("debate DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
