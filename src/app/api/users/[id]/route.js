import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isTopAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isTopAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const data = await req.json();
    const allowed = ["role", "home_district_id", "is_active", "scope_zone_id", "scope_assembly_id"];
    const sets = [];
    const vals = [];
    for (const f of allowed) {
      if (f in data) {
        sets.push(`${f} = ?`);
        vals.push(data[f] === "" ? null : data[f]);
      }
    }
    if (sets.length === 0) return NextResponse.json({ message: "No fields to update" }, { status: 400 });
    vals.push(id);
    await query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, vals);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("users PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
