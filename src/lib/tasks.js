import { query } from "@/lib/db";

// Whether the checklist table exists yet (added by add-task-subtasks). Cached so
// task reads don't hit information_schema every request; degrades gracefully to
// "no subtasks" pre-migration.
let hasSubtasksPromise;
export async function hasSubtasksTable() {
  if (!hasSubtasksPromise) {
    hasSubtasksPromise = query(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_subtasks'`
    ).then((r) => Number(r[0]?.n || 0) > 0).catch(() => { hasSubtasksPromise = undefined; return false; });
  }
  return hasSubtasksPromise;
}

// Whether tasks.contact_id exists yet. Cached, READ-ONLY (never runs DDL) so it
// is safe to call on the write path — unlike ensureTaskContactColumn(), which
// issues an ALTER TABLE + FK that can block on a metadata lock under concurrent
// load and hang the request. Task creation includes contact_id only when this
// says the column is present; otherwise the column is simply omitted.
let hasContactColPromise;
export async function hasTaskContactColumn() {
  if (!hasContactColPromise) {
    hasContactColPromise = query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'contact_id'`
    ).then((r) => Number(r[0]?.n || 0) > 0).catch(() => { hasContactColPromise = undefined; return false; });
  }
  return hasContactColPromise;
}

// Whether tasks.assigned_at exists yet (added by add-task-assigned-at). Cached.
let hasAssignedAtPromise;
export async function hasTaskAssignedAt() {
  if (!hasAssignedAtPromise) {
    hasAssignedAtPromise = query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'assigned_at'`
    ).then((r) => Number(r[0]?.n || 0) > 0).catch(() => { hasAssignedAtPromise = undefined; return false; });
  }
  return hasAssignedAtPromise;
}

// Whether tasks.start_date/duration_preset/duration_days exist yet (added by
// add-task-duration). Cached.
let hasDurationPromise;
export async function hasTaskDurationColumns() {
  if (!hasDurationPromise) {
    hasDurationPromise = query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'start_date'`
    ).then((r) => Number(r[0]?.n || 0) > 0).catch(() => { hasDurationPromise = undefined; return false; });
  }
  return hasDurationPromise;
}

// Fetch checklist items for a set of task ids in ONE query (no N+1), grouped by
// task_id and ordered by sort_order.
export async function subtasksByTask(taskIds) {
  if (!taskIds.length || !(await hasSubtasksTable())) return {};
  const ph = taskIds.map(() => "?").join(",");
  const rows = await query(
    `SELECT s.id, s.task_id, s.title, s.is_completed, s.sort_order, s.completed_at,
            u.username AS completed_by_name
       FROM task_subtasks s
       LEFT JOIN users u ON u.id = s.completed_by_user_id
      WHERE s.task_id IN (${ph})
      ORDER BY s.sort_order ASC, s.id ASC`,
    taskIds
  );
  const map = {};
  for (const r of rows) {
    (map[r.task_id] ||= []).push({
      id: r.id, title: r.title, is_completed: !!r.is_completed,
      completed_at: r.completed_at, completed_by_name: r.completed_by_name,
    });
  }
  return map;
}

// Recompute a master task's status from its checklist: all items done →
// completed, some → in_progress, none → pending. A task with NO checklist keeps
// whatever status was set manually (returns null).
export async function recomputeTaskStatus(taskId) {
  if (!(await hasSubtasksTable())) return null;
  const rows = await query("SELECT COUNT(*) AS total, SUM(is_completed) AS done FROM task_subtasks WHERE task_id = ?", [taskId]);
  const total = Number(rows[0]?.total || 0);
  if (total === 0) return null;
  const done = Number(rows[0]?.done || 0);
  const status = done === total ? "completed" : done > 0 ? "in_progress" : "pending";
  await query(
    `UPDATE tasks SET status = ?, completed_at = ${status === "completed" ? "NOW()" : "NULL"} WHERE id = ?`,
    [status, taskId]
  );
  return { status, total, done };
}
