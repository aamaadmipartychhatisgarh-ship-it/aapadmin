import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureUserTeamMembers } from "@/lib/teamSchema";
import { recomputeTaskStatus } from "@/lib/tasks";
import { emitLiveEvent, LIVE_EVENTS } from "@/lib/liveEvents";

// PATCH /api/tasks/subtasks/[id]  { completed: boolean }
// Toggle one checklist item, record who/when, then auto-recompute the master
// task's status (all done → completed). Anyone working the task may tick items:
// the assignee, a member of the assigned team, or an oversight user.
export async function PATCH(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const { completed } = await req.json().catch(() => ({}));

    // Resolve the parent task + check the user may work it.
    const rows = await query(
      `SELECT t.id, t.assigned_to_user_id, t.assigned_to_team_id
         FROM task_subtasks s JOIN tasks t ON t.id = s.task_id
        WHERE s.id = ?`,
      [id]
    );
    const task = rows[0];
    if (!task) return NextResponse.json({ message: "Not found" }, { status: 404 });

    let allowed = isOversight(session) || String(task.assigned_to_user_id) === String(session.user.id);
    if (!allowed && task.assigned_to_team_id) {
      await ensureUserTeamMembers();
      const m = await query(
        "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1",
        [task.assigned_to_team_id, session.user.id]
      );
      allowed = m.length > 0;
    }
    if (!allowed) return NextResponse.json({ message: "Unauthorized" }, { status: 403 });

    const done = completed ? 1 : 0;
    await query(
      `UPDATE task_subtasks
          SET is_completed = ?,
              completed_by_user_id = ${done ? "?" : "NULL"},
              completed_at = ${done ? "NOW()" : "NULL"}
        WHERE id = ?`,
      done ? [done, session.user.id, id] : [done, id]
    );

    // Auto-status: all items done → task completed, some → in_progress, none → pending.
    const progress = await recomputeTaskStatus(task.id);
    if (progress?.status === "completed") emitLiveEvent(LIVE_EVENTS.TASK_COMPLETED, { task_id: task.id });
    return NextResponse.json({ ok: true, ...(progress || {}) });
  } catch (err) {
    console.error("subtask toggle error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
