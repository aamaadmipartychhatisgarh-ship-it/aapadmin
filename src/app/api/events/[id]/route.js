import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const d = await req.json();
    const fields = ["title", "type", "description", "event_date", "event_time", "venue", "district_id", "zone_id", "status"];
    const sets = [], vals = [];
    for (const f of fields) if (f in d) { sets.push(`${f} = ?`); vals.push(d[f] === "" ? null : d[f]); }
    if (!sets.length) return NextResponse.json({ message: "No fields" }, { status: 400 });
    vals.push(id);
    await query(`UPDATE events SET ${sets.join(", ")} WHERE id = ?`, vals);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("event PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const [ev] = await query("SELECT title, event_date FROM events WHERE id = ?", [id]);
    await query("DELETE FROM event_attendees WHERE event_id = ?", [id]);
    await query("DELETE FROM events WHERE id = ?", [id]);
    await logAudit(session, { action: "event.delete", entityType: "event", entityId: id, details: ev || null });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("event DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
