import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isCaller } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const d = await req.json();

    // Assignees can update status of their own tasks (directly assigned or via
    // a team they belong to); oversight can edit anything.
    if (!isOversight(session)) {
      const [row] = await query("SELECT assigned_to_user_id, assigned_to_team_id, contact_id FROM tasks WHERE id = ?", [id])
        .catch(() => query("SELECT assigned_to_user_id, assigned_to_team_id, NULL AS contact_id FROM tasks WHERE id = ?", [id]));
      let mine = row && String(row.assigned_to_user_id) === String(session.user.id);
      if (!mine && row?.assigned_to_team_id) {
        const member = await query(
          "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1",
          [row.assigned_to_team_id, session.user.id]
        ).catch(() => []);
        mine = member.length > 0;
      }
      // Contact-linked tasks are workable by any caller — they update the status
      // right from the workspace while calling that contact.
      if (!mine && row?.contact_id && isCaller(session)) mine = true;
      if (!mine) {
        return NextResponse.json({ message: "Forbidden" }, { status: 403 });
      }
    }

    const fields = isOversight(session)
      ? ["title", "description", "priority", "status", "deadline", "assigned_to_user_id", "assigned_to_team_id", "district_id"]
      : ["status"];
    const sets = [], vals = [];
    for (const f of fields) if (f in d) { sets.push(`${f} = ?`); vals.push(d[f] === "" ? null : d[f]); }
    if ("status" in d && d.status === "completed") sets.push("completed_at = NOW()");
    if (!sets.length) return NextResponse.json({ message: "No fields" }, { status: 400 });
    vals.push(id);
    await query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, vals);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("task PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    await query("DELETE FROM tasks WHERE id = ?", [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("task DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
