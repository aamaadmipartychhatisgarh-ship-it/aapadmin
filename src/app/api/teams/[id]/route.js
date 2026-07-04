import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureUserTeamMembers } from "@/lib/teamSchema";

export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    await ensureUserTeamMembers();
    const { id } = await params;
    const [team] = await query(
      `SELECT t.*, l.name AS location_name, w.name AS leader_name
         FROM teams t LEFT JOIN locations l ON l.id = t.location_id
         LEFT JOIN workers w ON w.id = t.leader_worker_id WHERE t.id = ?`, [id]
    );
    if (!team) return NextResponse.json({ message: "Not found" }, { status: 404 });
    // Members are user accounts (tm.user_id) or field workers (tm.worker_id).
    const members = await query(
      `SELECT tm.id AS membership_id, tm.role_in_team, tm.user_id, tm.worker_id,
              CASE WHEN tm.user_id IS NOT NULL THEN 'user' ELSE 'worker' END AS member_type,
              COALESCE(u.username, w.name) AS name,
              u.role AS user_role,
              w.id AS id, w.position, w.activity_score, w.status
         FROM team_members tm
         LEFT JOIN users u ON u.id = tm.user_id
         LEFT JOIN workers w ON w.id = tm.worker_id
        WHERE tm.team_id = ?
        ORDER BY tm.user_id IS NULL, w.activity_score DESC`, [id]
    );
    return NextResponse.json({ team, members });
  } catch (err) {
    console.error("team GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const d = await req.json();
    const fields = ["name", "level", "location_id", "leader_worker_id"];
    const sets = [], vals = [];
    for (const f of fields) if (f in d) { sets.push(`${f} = ?`); vals.push(d[f] === "" ? null : d[f]); }
    if (!sets.length) return NextResponse.json({ message: "No fields" }, { status: 400 });
    vals.push(id);
    await query(`UPDATE teams SET ${sets.join(", ")} WHERE id = ?`, vals);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("team PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    await query("DELETE FROM teams WHERE id = ?", [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("team DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
