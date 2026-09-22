import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureComplaintColumns } from "../route";

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensureComplaintColumns();
    const { id } = await params;
    const d = await req.json();
    // Editable fields — includes the citizen/person details the edit modal sends
    // (previously omitted, so editing name/phone/district silently didn't save).
    const fields = ["citizen_name", "citizen_phone", "district_id", "status", "assigned_team_id", "resolution_notes", "type", "description", "designation_id"];
    const sets = [], vals = [];
    for (const f of fields) if (f in d) { sets.push(`${f} = ?`); vals.push(d[f] === "" ? null : d[f]); }
    if (d.status === "resolved" || d.status === "closed") sets.push("resolved_at = NOW()");
    if (!sets.length) return NextResponse.json({ message: "No fields" }, { status: 400 });
    vals.push(id);
    await query(`UPDATE complaints SET ${sets.join(", ")} WHERE id = ?`, vals);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("complaint PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/complaints/[id] — permanently remove ONE complaint. Restricted to
// oversight roles (same as editing). The row is deleted by its exact id, so the
// correct record is removed regardless of the client's row/index order.
export async function DELETE(_req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const [existing] = await query("SELECT id FROM complaints WHERE id = ?", [id]);
    if (!existing) return NextResponse.json({ message: "Complaint not found." }, { status: 404 });
    await query("DELETE FROM complaints WHERE id = ?", [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("complaint DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
