import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const admin = isAdmin(session);
    if (!admin) {
      // Callers may only edit the contact they currently hold (locked mid-call),
      // and only its basic details — not assignment or completion state.
      const [row] = await query("SELECT locked_by_user_id FROM contacts WHERE id = ?", [id]);
      if (!row || String(row.locked_by_user_id) !== String(session.user.id)) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
      }
    }
    const data = await req.json();
    const fields = admin
      ? ["person_name", "phone_number", "address", "designation_id", "district_id", "ward_id", "booth_id", "assigned_to_user_id", "is_completed"]
      : ["person_name", "phone_number", "address", "designation_id", "district_id"];
    const sets = [];
    const vals = [];
    for (const f of fields) {
      if (f in data) { sets.push(`${f} = ?`); vals.push(data[f] === "" ? null : data[f]); }
    }
    if (sets.length === 0) return NextResponse.json({ message: "No fields to update" }, { status: 400 });
    vals.push(id);
    await query(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`, vals);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("contacts PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    await query("DELETE FROM contacts WHERE id = ?", [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("contacts DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
