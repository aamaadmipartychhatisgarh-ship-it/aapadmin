import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isTopAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";
import bcrypt from "bcryptjs";

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isTopAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const data = await req.json();

    const sets = [];
    const vals = [];

    // Plain column updates.
    const allowed = ["role", "home_district_id", "is_active", "scope_zone_id", "scope_assembly_id"];
    for (const f of allowed) {
      if (f in data) {
        sets.push(`${f} = ?`);
        vals.push(data[f] === "" ? null : data[f]);
      }
    }

    // Username (validate + check uniqueness).
    if (typeof data.username === "string" && data.username.trim()) {
      const username = data.username.trim();
      const dupe = await query("SELECT id FROM users WHERE username = ? AND id <> ?", [username, id]);
      if (dupe.length) {
        return NextResponse.json({ message: "That username is already taken." }, { status: 409 });
      }
      sets.push("username = ?");
      vals.push(username);
    }

    // Password (optional — only if a non-empty value is provided).
    if (typeof data.password === "string" && data.password.length > 0) {
      if (data.password.length < 4) {
        return NextResponse.json({ message: "Password must be at least 4 characters." }, { status: 400 });
      }
      sets.push("password = ?");
      vals.push(bcrypt.hashSync(data.password, 10));
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

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isTopAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;

    // Don't let an admin delete their own account.
    if (String(session.user.id) === String(id)) {
      return NextResponse.json({ message: "You can't delete your own account." }, { status: 400 });
    }

    await query("DELETE FROM users WHERE id = ?", [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Foreign-key references (e.g. contacts assigned to this user) are SET NULL
    // by the schema, so deletion should succeed; surface anything unexpected.
    console.error("users DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
