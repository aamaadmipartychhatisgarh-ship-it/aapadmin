import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, isOversight, scopeFilterSync } from "@/lib/permissions";
import { resolveActingUserId } from "@/lib/actAs";
import { query } from "@/lib/db";
import { ensureUserTeamMembers } from "@/lib/teamSchema";
import { ensureTaskContactColumn } from "@/lib/taskSchema";
import { notifyTaskAssigned } from "@/lib/notify";
import { subtasksByTask, hasSubtasksTable, hasTaskAssignedAt, hasTaskDurationColumns } from "@/lib/tasks";
import { addDays } from "@/lib/taskDuration";

// GET /api/tasks?view=mine|all|pending&status=&priority=&district_id=&assigned_to=&search=
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    // A previewing Super Admin's "My Tasks" resolves to the impersonated
    // caller's tasks (never spoofable — verified server-side).
    const { userId: actingUserId, impersonating } = await resolveActingUserId(session);
    const { searchParams } = new URL(req.url);
    const view = searchParams.get("view") || "all";
    const statusF = searchParams.get("status");
    const priority = searchParams.get("priority");
    const districtId = searchParams.get("district_id");
    const assignedTo = searchParams.get("assigned_to");
    const search = searchParams.get("search");
    const contactId = searchParams.get("contact_id");

    const where = [];
    const params = [];
    // Tasks pinned to a specific contact are visible to whoever is working that
    // contact (the telecaller sees them mid-call), regardless of assignee.
    if (contactId) {
      await ensureTaskContactColumn();
      where.push("t.contact_id = ?");
      params.push(contactId);
    } else if (view === "mine" || !isOversight(session) || impersonating) {
      // Non-oversight users (and a Super Admin previewing a caller) only see
      // their own tasks — assigned directly or via a team they belong to.
      await ensureUserTeamMembers();
      const meId = impersonating ? actingUserId : session.user.id;
      where.push("(t.assigned_to_user_id = ? OR t.assigned_to_team_id IN (SELECT tm.team_id FROM team_members tm WHERE tm.user_id = ?))");
      params.push(meId, meId);
    }
    if (view === "pending") where.push("t.status IN ('pending','in_progress')");
    if (statusF) { where.push("t.status = ?"); params.push(statusF); }
    if (priority) { where.push("t.priority = ?"); params.push(priority); }
    if (districtId) { where.push("t.district_id = ?"); params.push(districtId); }
    if (assignedTo) { where.push("t.assigned_to_user_id = ?"); params.push(assignedTo); }
    if (search) { where.push("t.title LIKE ?"); params.push(`%${search}%`); }
    // Geographic scope (oversight only — caller already filtered to own tasks above).
    // tasks table only has district_id, so declare that.
    if (isOversight(session) && view !== "mine" && !impersonating) {
      const scope = scopeFilterSync(session.user, "t", { cols: ["district_id"] });
      if (scope.where) { where.push(scope.where.replace(/^AND /, "")); params.push(...scope.params); }
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // Default sort = most recently ASSIGNED first (assigned_at, not created_at).
    const sort = searchParams.get("sort") || "newest";
    const assignedExpr = (await hasTaskAssignedAt()) ? "COALESCE(t.assigned_at, t.created_at)" : "t.created_at";
    const ORDER = {
      newest: `${assignedExpr} DESC`,
      oldest: `${assignedExpr} ASC`,
      priority: `FIELD(t.priority,'urgent','high','medium','low'), ${assignedExpr} DESC`,
      deadline: `t.deadline IS NULL, t.deadline ASC, ${assignedExpr} DESC`,
      status: `FIELD(t.status,'in_progress','pending','completed','cancelled'), ${assignedExpr} DESC`,
      title_az: "t.title ASC",
      title_za: "t.title DESC",
    };
    const orderBy = ORDER[sort] || ORDER.newest;

    const tasks = await query(
      `SELECT t.*, u.username AS assignee_name, tm.name AS team_name, ld.name AS district_name,
              cu.username AS created_by_name
         FROM tasks t
         LEFT JOIN users u ON u.id = t.assigned_to_user_id
         LEFT JOIN teams tm ON tm.id = t.assigned_to_team_id
         LEFT JOIN locations ld ON ld.id = t.district_id
         LEFT JOIN users cu ON cu.id = t.created_by_user_id
         ${whereSql}
         ORDER BY ${orderBy}`,
      params
    );

    // Counts for the summary strip
    const [[counts]] = await query(
      `SELECT
         COUNT(*) AS total,
         SUM(status='pending') AS pending,
         SUM(status='in_progress') AS in_progress,
         SUM(status='completed') AS completed,
         SUM(deadline < CURDATE() AND status IN ('pending','in_progress')) AS overdue
       FROM tasks t ${whereSql}`, params
    ).then((r) => [r]);

    // Attach each master task's checklist (one query, grouped) + progress.
    const subMap = await subtasksByTask(tasks.map((t) => t.id));
    for (const t of tasks) {
      t.subtasks = subMap[t.id] || [];
      t.subtask_total = t.subtasks.length;
      t.subtask_done = t.subtasks.filter((s) => s.is_completed).length;
    }

    return NextResponse.json({ tasks, counts });
  } catch (err) {
    console.error("tasks GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const d = await req.json();
    if (!d.title) return NextResponse.json({ message: "Title required" }, { status: 400 });
    await ensureTaskContactColumn();
    // Stamp assigned_at at creation (this is the initial assignment time).
    const stampAssigned = await hasTaskAssignedAt();
    const hasDuration = await hasTaskDurationColumns();
    // The deadline is derived from start_date + duration_days when both are
    // given (the normal path, via the duration picker); an explicit d.deadline
    // is only a fallback for callers that don't use the duration picker.
    const deadline = (hasDuration && d.start_date && d.duration_days)
      ? addDays(d.start_date, d.duration_days) : (d.deadline || null);
    // The Description field has been retired from the Tasks module. The column
    // is left in place (nullable) so existing tasks keep their stored text; new
    // tasks simply never write it.
    // Multi-assign: a task may be assigned to several users at once. Each
    // selected user gets their OWN task record (fan-out) so it shows up
    // independently in every assignee's list. Accepts the new
    // assigned_to_user_ids array; falls back to the legacy single
    // assigned_to_user_id, and to [null] (team-only / unassigned) when neither
    // is given — so existing single-assignee and team behavior is unchanged.
    const userIds = Array.isArray(d.assigned_to_user_ids)
      ? [...new Set(d.assigned_to_user_ids.map((x) => String(x).trim()).filter(Boolean))]
      : (d.assigned_to_user_id ? [String(d.assigned_to_user_id)] : []);
    const targets = userIds.length ? userIds : [null];

    // Prepare the checklist once (same items for every fanned-out task).
    const subs = Array.isArray(d.subtasks) ? d.subtasks : [];
    const titles = subs.map((s) => (typeof s === "string" ? s : s?.title) || "").map((t) => t.trim()).filter(Boolean);
    const subsTable = titles.length ? await hasSubtasksTable() : false;

    const createdIds = [];
    for (const uid of targets) {
      const res = await query(
        `INSERT INTO tasks (title, priority, status, deadline, assigned_to_user_id, assigned_to_team_id, district_id, contact_id, created_by_user_id${stampAssigned ? ", assigned_at" : ""}${hasDuration ? ", start_date, duration_preset, duration_days" : ""})
         VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?${stampAssigned ? ", NOW()" : ""}${hasDuration ? ", ?, ?, ?" : ""})`,
        [d.title, d.priority || "medium", deadline,
         uid || null, d.assigned_to_team_id || null, d.district_id || null,
         d.contact_id || null, session.user.id,
         ...(hasDuration ? [d.start_date || null, d.duration_preset || null, d.duration_days || null] : [])]
      );
      createdIds.push(res.insertId);
      // Persist the checklist (unlimited items) for this task.
      if (subsTable) {
        const values = titles.map(() => "(?, ?, ?)").join(", ");
        const params = [];
        titles.forEach((t, i) => params.push(res.insertId, t, i));
        await query(`INSERT INTO task_subtasks (task_id, title, sort_order) VALUES ${values}`, params);
      }
      // Alert the assigned caller / team. Don't notify the person who created it.
      if (uid || d.assigned_to_team_id) {
        await notifyTaskAssigned({
          taskId: res.insertId,
          title: d.title,
          assignedToUserId: uid || null,
          assignedToTeamId: d.assigned_to_team_id || null,
          excludeUserId: session.user.id,
        });
      }
    }
    return NextResponse.json({ id: createdIds[0], ids: createdIds }, { status: 201 });
  } catch (err) {
    console.error("tasks POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
