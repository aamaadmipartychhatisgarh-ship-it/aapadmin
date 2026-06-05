import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, isOversight, scopeFilterSync } from "@/lib/permissions";
import { query } from "@/lib/db";

// GET /api/tasks?view=mine|all|pending&status=&priority=
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(req.url);
    const view = searchParams.get("view") || "all";
    const statusF = searchParams.get("status");
    const priority = searchParams.get("priority");

    const where = [];
    const params = [];
    // Non-oversight users only see their own tasks.
    if (view === "mine" || !isOversight(session)) {
      where.push("t.assigned_to_user_id = ?");
      params.push(session.user.id);
    }
    if (view === "pending") where.push("t.status IN ('pending','in_progress')");
    if (statusF) { where.push("t.status = ?"); params.push(statusF); }
    if (priority) { where.push("t.priority = ?"); params.push(priority); }
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
    const res = await query(
      `INSERT INTO tasks (title, description, priority, status, deadline, assigned_to_user_id, assigned_to_team_id, district_id, created_by_user_id)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      [d.title, d.description || null, d.priority || "medium", d.deadline || null,
       d.assigned_to_user_id || null, d.assigned_to_team_id || null, d.district_id || null, session.user.id]
    );
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("tasks POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
