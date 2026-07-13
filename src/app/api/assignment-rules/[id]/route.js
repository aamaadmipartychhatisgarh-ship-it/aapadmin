import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";
import { parseIds } from "@/lib/assignmentRules";

// PUT: update editable fields of a rule (toggle active, change quota/scope).
export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const b = await req.json();
    const sets = [];
    const vals = [];
    if ("is_active" in b) { sets.push("is_active = ?"); vals.push(b.is_active ? 1 : 0); }
    if ("daily_quota" in b) { sets.push("daily_quota = ?"); vals.push(Math.max(1, parseInt(b.daily_quota, 10) || 100)); }
    if ("stale_days" in b) { sets.push("stale_days = ?"); vals.push(Math.max(1, parseInt(b.stale_days, 10) || 3)); }
    if ("designation_ids" in b) {
      const csv = parseIds(Array.isArray(b.designation_ids) ? b.designation_ids.join(",") : b.designation_ids).join(",");
      sets.push("designation_ids = ?"); vals.push(csv || null);
    }
    for (const f of ["zone_id", "lok_sabha_id", "district_id", "assembly_id"]) {
      if (f in b) { sets.push(`${f} = ?`); vals.push(b[f] || null); }
    }
    if (sets.length === 0) return NextResponse.json({ message: "Nothing to update" }, { status: 400 });
    vals.push(id);
    await query(`UPDATE assignment_rules SET ${sets.join(", ")} WHERE id = ?`, vals);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("assignment-rules PUT error:", err);
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
    await query("DELETE FROM assignment_rules WHERE id = ?", [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("assignment-rules DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
