import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, isOversight, scopeFilterSync } from "@/lib/permissions";
import { resolveActingUserId } from "@/lib/actAs";
import { query, getPool } from "@/lib/db";
import { ensureUserTeamMembers } from "@/lib/teamSchema";
import { ensureTaskContactColumn } from "@/lib/taskSchema";
import { notifyTaskAssigned } from "@/lib/notify";
import { subtasksByTask, hasSubtasksTable, hasTaskAssignedAt, hasTaskDurationColumns, hasTaskContactColumn } from "@/lib/tasks";
import { addDays } from "@/lib/taskDuration";

// The task list must ALWAYS reflect the latest data — never a cached response.
// Without this, a GET to the same URL (e.g. /api/tasks?view=all) can be served
// from the browser/proxy (LiteSpeed) HTTP cache in production, so the refetch
// right after creating a task returns the stale list WITHOUT the new task.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

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
    // Status/overdue views for the Tasks page tabs. Overdue is DERIVED (deadline
    // past + not completed), never a stored status.
    if (view === "pending") where.push("t.status = 'pending'");
    else if (view === "in_progress") where.push("t.status = 'in_progress'");
    else if (view === "completed") where.push("t.status = 'completed'");
    else if (view === "overdue") where.push("t.deadline < CURDATE() AND t.status IN ('pending','in_progress')");
    // Due-today filter (used by the Due Today card / caller widget).
    if (searchParams.get("due") === "today") where.push("t.deadline = CURDATE()");
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
         SUM(deadline < CURDATE() AND status IN ('pending','in_progress')) AS overdue,
         SUM(deadline = CURDATE() AND status IN ('pending','in_progress')) AS due_today
       FROM tasks t ${whereSql}`, params
    ).then((r) => [r]);

    // Attach each master task's checklist (one query, grouped) + progress, plus
    // a DERIVED overdue flag (deadline past & not completed) for the UI.
    const todayStr = new Date().toISOString().slice(0, 10);
    const subMap = await subtasksByTask(tasks.map((t) => t.id));
    for (const t of tasks) {
      t.subtasks = subMap[t.id] || [];
      t.subtask_total = t.subtasks.length;
      t.subtask_done = t.subtasks.filter((s) => s.is_completed).length;
      const dl = t.deadline ? String(t.deadline).slice(0, 10) : null;
      t.is_overdue = !!(dl && dl < todayStr && t.status !== "completed" && t.status !== "cancelled");
      t.due_today = !!(dl && dl === todayStr && t.status !== "completed" && t.status !== "cancelled");
    }

    return NextResponse.json({ tasks, counts }, { headers: NO_STORE });
  } catch (err) {
    console.error("tasks GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

// Build marker so the LIVE deploy can be identified from a task response header
// (X-Tasks-Build) and the server logs — confirms which code is actually running.
const BUILD = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

const VALID_PRIORITIES = ["low", "medium", "high", "urgent"];
const H = () => ({ "X-Tasks-Build": BUILD });
const bad = (message, status = 400) => NextResponse.json({ message }, { status, headers: H() });

export async function POST(req) {
  const t0 = Date.now();
  let conn;
  try {
    console.log(`[TASK] POST START build=${BUILD}`);
    // --- auth ---
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) { console.log("[TASK] AUTH FAIL 401"); return bad("Unauthorized", 401); }
    console.log("[TASK] AUTH OK user=", session.user?.id);
    const d = await req.json().catch(() => null);
    if (!d || typeof d !== "object") return bad("Invalid request body");

    // --- backend validation (never trust the client alone) ---
    const title = String(d.title ?? "").trim();
    if (!title) { console.log("[TASK] VALIDATION FAIL: no title"); return bad("Task title is required."); }
    const priority = d.priority ? String(d.priority) : "medium";
    if (!VALID_PRIORITIES.includes(priority)) return bad("Invalid priority.");

    // Assignees: dedup the multi-select ids; fall back to the legacy single id.
    const userIds = Array.isArray(d.assigned_to_user_ids)
      ? [...new Set(d.assigned_to_user_ids.map((x) => String(x).trim()).filter(Boolean))]
      : (d.assigned_to_user_id ? [String(d.assigned_to_user_id)] : []);
    const teamId = d.assigned_to_team_id ? String(d.assigned_to_team_id).trim() : null;

    // Schema probes (cached, read-only — the create path runs NO DDL).
    const stampAssigned = await hasTaskAssignedAt();
    const hasDuration = await hasTaskDurationColumns();
    const hasContactCol = await hasTaskContactColumn();

    // Dates: start + duration → deadline; validate the derived range.
    const startDate = (hasDuration && d.start_date) ? String(d.start_date).slice(0, 10) : null;
    let durationDays = (d.duration_days === "" || d.duration_days == null) ? null : Number(d.duration_days);
    if (durationDays != null && (!Number.isFinite(durationDays) || durationDays < 1)) return bad("Duration must be at least 1 day.");
    const deadline = (hasDuration && startDate && durationDays) ? addDays(startDate, durationDays) : (d.deadline || null);
    if (startDate && deadline && String(deadline) < String(startDate)) return bad("End date cannot be before the start date.");

    // Validate assignees/team exist (the dropdowns only offer valid options, but
    // the server verifies anyway so a stale/forged id can't create a bad row).
    if (userIds.length) {
      const rows = await query(`SELECT id FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`, userIds);
      if (rows.length !== userIds.length) return bad("One or more selected assignees are invalid.");
    }
    if (teamId) {
      const tr = await query("SELECT id FROM teams WHERE id = ?", [teamId]);
      if (!tr.length) return bad("The selected team is invalid.");
    }

    // Checklist: keep only non-empty titles (blank rows are ignored; a task with
    // no subtasks is valid). Same list applies to every fanned-out task.
    const titles = (Array.isArray(d.subtasks) ? d.subtasks : [])
      .map((s) => (typeof s === "string" ? s : s?.title) || "").map((t) => t.trim()).filter(Boolean);
    const subsTable = titles.length ? await hasSubtasksTable() : false;

    // Multi-assign fan-out: one task row per selected user (or a single
    // unassigned/team row when none). Each gets the same checklist.
    const targets = userIds.length ? userIds : [null];
    console.log(`[TASK] VALIDATION OK (${Date.now() - t0}ms) targets=${targets.length} subs=${titles.length} subsTable=${subsTable}`);

    // --- single atomic transaction: all task rows + their subtasks commit
    // together, or nothing does. The connection is always released. ---
    conn = await getPool().getConnection();
    const created = [];
    try {
      await conn.beginTransaction();
      for (const uid of targets) {
        const [res] = await conn.execute(
          `INSERT INTO tasks (title, priority, status, deadline, assigned_to_user_id, assigned_to_team_id, district_id${hasContactCol ? ", contact_id" : ""}, created_by_user_id${stampAssigned ? ", assigned_at" : ""}${hasDuration ? ", start_date, duration_preset, duration_days" : ""})
           VALUES (?, ?, 'pending', ?, ?, ?, ?${hasContactCol ? ", ?" : ""}, ?${stampAssigned ? ", NOW()" : ""}${hasDuration ? ", ?, ?, ?" : ""})`,
          [title, priority, deadline,
           uid || null, teamId, d.district_id || null,
           ...(hasContactCol ? [d.contact_id || null] : []),
           session.user.id,
           ...(hasDuration ? [startDate, d.duration_preset || null, durationDays] : [])]
        );
        const taskId = res.insertId;
        created.push({ taskId, uid });
        // Subtasks in the SAME transaction — start incomplete (is_completed=0).
        if (subsTable) {
          const values = titles.map(() => "(?, ?, ?)").join(", ");
          const params = [];
          titles.forEach((t, i) => params.push(taskId, t, i));
          await conn.execute(`INSERT INTO task_subtasks (task_id, title, sort_order) VALUES ${values}`, params);
        }
      }
      await conn.commit();
      console.log(`[TASK] COMMIT (${Date.now() - t0}ms) ids=${created.map((c) => c.taskId).join(",")}`);
    } catch (txErr) {
      try { await conn.rollback(); } catch { /* connection may be dead */ }
      throw txErr;
    }

    // --- post-commit side effects: notifications are NOT part of task
    // integrity, so they run after commit and never block or roll back the
    // create. notifyTaskAssigned already swallows its own errors. ---
    for (const { taskId, uid } of created) {
      if (uid || teamId) {
        try {
          await notifyTaskAssigned({ taskId, title, assignedToUserId: uid || null, assignedToTeamId: teamId, excludeUserId: session.user.id });
        } catch (e) { console.error("task notify failed:", e); }
      }
    }

    const ids = created.map((c) => c.taskId);
    console.log(`[TASK] RESPONSE 201 (${Date.now() - t0}ms) ids=${ids.join(",")}`);
    return NextResponse.json({ id: ids[0], ids }, { status: 201, headers: H() });
  } catch (err) {
    console.error(`[TASK] ERROR (${Date.now() - t0}ms):`, err?.code || "", err?.message || err);
    return NextResponse.json({ message: err?.sqlMessage || "Could not create the task. Please try again." }, { status: 500, headers: H() });
  } finally {
    if (conn) { try { conn.release(); } catch { /* already released */ } }
  }
}
