import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isCaller } from "@/lib/permissions";
import { query } from "@/lib/db";
import { notifyTaskCreated } from "@/lib/notify";
import { recomputeTaskStatus, hasSubtasksTable, hasTaskAssignedAt, hasTaskDurationColumns } from "@/lib/tasks";
import { addDays } from "@/lib/taskDuration";
import { emitLiveEvent, LIVE_EVENTS } from "@/lib/liveEvents";

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

    const hasDuration = await hasTaskDurationColumns();
    // Description has been retired from the Tasks module — it's no longer an
    // editable field (the column stays for existing rows but is never updated).
    const fields = isOversight(session)
      ? ["title", "priority", "status", "deadline", "assigned_to_user_id", "assigned_to_team_id", "district_id",
         ...(hasDuration ? ["start_date", "duration_preset", "duration_days"] : [])]
      : ["status"];
    // The duration picker drives the deadline: if both start_date and
    // duration_days are being set, recompute deadline from them instead of
    // trusting a stale/absent value from the client.
    if (hasDuration && isOversight(session) && "start_date" in d && "duration_days" in d && d.start_date && d.duration_days) {
      d.deadline = addDays(d.start_date, d.duration_days);
    }
    const sets = [], vals = [];
    for (const f of fields) if (f in d) { sets.push(`${f} = ?`); vals.push(d[f] === "" ? null : d[f]); }
    if ("status" in d && d.status === "completed") sets.push("completed_at = NOW()");
    // Reassigning (changing the assignee/team) refreshes assigned_at to now, so
    // the list re-sorts the task to the top by latest assignment.
    if (isOversight(session) && (("assigned_to_user_id" in d && d.assigned_to_user_id) || ("assigned_to_team_id" in d && d.assigned_to_team_id)) && (await hasTaskAssignedAt())) {
      sets.push("assigned_at = NOW()");
    }
    if (!sets.length) return NextResponse.json({ message: "No fields" }, { status: 400 });
    const isCompleting = "status" in d && d.status === "completed";
    vals.push(id);
    await query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, vals);
    if (isCompleting) emitLiveEvent(LIVE_EVENTS.TASK_COMPLETED, { task_id: id });

    // Reconcile the checklist (oversight edits only): keep items by id (update
    // title/order, preserving completion), insert new ones, delete removed ones,
    // then recompute the master status from the resulting checklist.
    if (isOversight(session) && Array.isArray(d.subtasks) && (await hasSubtasksTable())) {
      const incoming = d.subtasks
        .map((s, i) => ({ id: s?.id ? Number(s.id) : null, title: String(s?.title || "").trim(), sort: i }))
        .filter((s) => s.title);
      const existing = await query("SELECT id FROM task_subtasks WHERE task_id = ?", [id]);
      const keep = new Set(incoming.filter((s) => s.id).map((s) => s.id));
      const toDelete = existing.map((r) => r.id).filter((eid) => !keep.has(eid));
      if (toDelete.length) await query(`DELETE FROM task_subtasks WHERE id IN (${toDelete.map(() => "?").join(",")})`, toDelete);
      for (const s of incoming) {
        if (s.id) await query("UPDATE task_subtasks SET title = ?, sort_order = ? WHERE id = ? AND task_id = ?", [s.title, s.sort, s.id, id]);
        else await query("INSERT INTO task_subtasks (task_id, title, sort_order) VALUES (?, ?, ?)", [id, s.title, s.sort]);
      }
      const recomputed = await recomputeTaskStatus(id);
      if (recomputed?.status === "completed") emitLiveEvent(LIVE_EVENTS.TASK_COMPLETED, { task_id: id });
    }

    // If an oversight edit (re)assigned the task, alert the new assignee(s).
    if (isOversight(session) && (("assigned_to_user_id" in d && d.assigned_to_user_id) || ("assigned_to_team_id" in d && d.assigned_to_team_id))) {
      let title = d.title;
      if (title === undefined) {
        const [t] = await query("SELECT title FROM tasks WHERE id = ?", [id]);
        title = title ?? t?.title;
      }
      await notifyTaskCreated({
        taskId: id,
        title,
        assignedToUserId: d.assigned_to_user_id || null,
        assignedToTeamId: d.assigned_to_team_id || null,
        districtId: d.district_id || null,
        contactId: d.contact_id || null,
        createdByUserId: session.user.id,
        createdByName: session.user.name || session.user.username || null,
      });
    }
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
