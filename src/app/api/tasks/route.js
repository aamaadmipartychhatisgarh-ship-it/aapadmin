import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, isOversight, scopeFilterSync } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureUserTeamMembers } from "@/lib/teamSchema";
import { ensureTaskContactColumn } from "@/lib/taskSchema";
import { notifyTaskAssigned } from "@/lib/notify";

// GET /api/tasks?view=mine|all|pending&status=&priority=&district_id=&assigned_to=&search=
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
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
    } else if (view === "mine" || !isOversight(session)) {
      // Non-oversight users only see their own tasks — assigned directly or via a team they belong to.
      await ensureUserTeamMembers();
      where.push("(t.assigned_to_user_id = ? OR t.assigned_to_team_id IN (SELECT tm.team_id FROM team_members tm WHERE tm.user_id = ?))");
      params.push(session.user.id, session.user.id);
    }
    if (view === "pending") where.push("t.status IN ('pending','in_progress')");
    if (statusF) { where.push("t.status = ?"); params.push(statusF); }
    if (priority) { where.push("t.priority = ?"); params.push(priority); }
    if (districtId) { where.push("t.district_id = ?"); params.push(districtId); }
    if (assignedTo) { where.push("t.assigned_to_user_id = ?"); params.push(assignedTo); }
    if (search) { where.push("(t.title LIKE ? OR t.description LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
    // Geographic scope (oversight only — caller already filtered to own tasks above).
    // tasks table only has district_id, so declare that.
    if (isOversight(session) && view !== "mine") {
      const scope = scopeFilterSync(session.user, "t", { cols: ["district_id"] });
      if (scope.where) { where.push(scope.where.replace(/^AND /, "")); params.push(...scope.params); }
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const tasks = await query(
      `SELECT t.*, u.username AS assignee_name, tm.name AS team_name, ld.name AS district_name
         FROM tasks t
         LEFT JOIN users u ON u.id = t.assigned_to_user_id
         LEFT JOIN teams tm ON tm.id = t.assigned_to_team_id
         LEFT JOIN locations ld ON ld.id = t.district_id
         ${whereSql}
         ORDER BY FIELD(t.status,'in_progress','pending','completed','cancelled'),
                  FIELD(t.priority,'urgent','high','medium','low'),
                  t.deadline IS NULL, t.deadline ASC`,
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
    const res = await query(
      `INSERT INTO tasks (title, description, priority, status, deadline, assigned_to_user_id, assigned_to_team_id, district_id, contact_id, created_by_user_id)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      [d.title, d.description || null, d.priority || "medium", d.deadline || null,
       d.assigned_to_user_id || null, d.assigned_to_team_id || null, d.district_id || null,
       d.contact_id || null, session.user.id]
    );
    // Alert the assigned caller(s). Don't notify the person who created it.
    if (d.assigned_to_user_id || d.assigned_to_team_id) {
      await notifyTaskAssigned({
        taskId: res.insertId,
        title: d.title,
        description: d.description,
        assignedToUserId: d.assigned_to_user_id || null,
        assignedToTeamId: d.assigned_to_team_id || null,
        excludeUserId: session.user.id,
      });
    }
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("tasks POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
