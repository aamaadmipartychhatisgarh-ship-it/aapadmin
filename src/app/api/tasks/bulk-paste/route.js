import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { query, getPool } from "@/lib/db";
import { hasTaskAssignedAt, hasTaskDurationColumns } from "@/lib/tasks";
import { addDays } from "@/lib/taskDuration";
import { notifyTaskCreated } from "@/lib/notify";

// POST /api/tasks/bulk-paste — create MANY tasks in one atomic request from the
// "Paste Tasks" feature. Body:
//   { tasks: [{ userId, title }], common?: { priority, start_date, duration_days,
//     deadline, district_id }, idempotency_key?: string }
//
// Reuses the EXACT same tasks table, columns, default status ('pending'),
// priority values and created_by/assigned_to semantics as the single-task POST —
// so bulk-created tasks are indistinguishable from manually created ones. The
// browser is never trusted: every userId is re-validated server-side, and the
// whole batch is created inside ONE transaction (all-or-nothing).
export const dynamic = "force-dynamic";

const VALID_PRIORITIES = ["low", "medium", "high", "urgent"];
const MAX_TASKS = 2000; // generous cap so a paste can't runaway-insert

async function ensureIdempotencyTable() {
  await query(
    `CREATE TABLE IF NOT EXISTS task_bulk_imports (
       idempotency_key VARCHAR(64) PRIMARY KEY,
       created_by INT NULL,
       task_count INT NOT NULL DEFAULT 0,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

export async function POST(req) {
  let conn;
  try {
    // --- auth: task assignment is an oversight capability (same as the manual
    // single-task create). Callers/normal users are rejected here regardless of
    // any frontend state. ---
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const d = await req.json().catch(() => null);
    if (!d || typeof d !== "object" || !Array.isArray(d.tasks)) {
      return NextResponse.json({ message: "Invalid request body." }, { status: 400 });
    }

    // --- normalize + validate the rows (never trust the client) ---
    const rows = d.tasks
      .map((t) => ({ userId: String(t?.userId ?? "").trim(), title: String(t?.title ?? "").trim() }))
      .filter((t) => t.userId && t.title);
    if (rows.length === 0) {
      return NextResponse.json({ message: "No valid tasks to create." }, { status: 400 });
    }
    if (rows.length > MAX_TASKS) {
      return NextResponse.json({ message: `Too many tasks in one paste (max ${MAX_TASKS}).` }, { status: 400 });
    }

    const common = d.common || {};
    const priority = common.priority ? String(common.priority) : "medium";
    if (!VALID_PRIORITIES.includes(priority)) {
      return NextResponse.json({ message: "Invalid priority." }, { status: 400 });
    }

    const stampAssigned = await hasTaskAssignedAt();
    const hasDuration = await hasTaskDurationColumns();
    const startDate = (hasDuration && common.start_date) ? String(common.start_date).slice(0, 10) : null;
    let durationDays = (common.duration_days === "" || common.duration_days == null) ? null : Number(common.duration_days);
    if (durationDays != null && (!Number.isFinite(durationDays) || durationDays < 1)) {
      return NextResponse.json({ message: "Duration must be at least 1 day." }, { status: 400 });
    }
    const deadline = (hasDuration && startDate && durationDays)
      ? addDays(startDate, durationDays)
      : (common.deadline ? String(common.deadline).slice(0, 10) : null);
    if (startDate && deadline && String(deadline) < String(startDate)) {
      return NextResponse.json({ message: "End date cannot be before the start date." }, { status: 400 });
    }
    const districtId = common.district_id ? String(common.district_id) : null;

    // --- validate EVERY assignee exists (one query) — a forged/stale id can
    // never create a mis-assigned row. All-or-nothing: if any id is invalid, the
    // whole batch is rejected. ---
    const uniqueIds = [...new Set(rows.map((r) => r.userId))];
    const found = await query(
      `SELECT id FROM users WHERE id IN (${uniqueIds.map(() => "?").join(",")})`,
      uniqueIds
    );
    const validIds = new Set(found.map((u) => String(u.id)));
    const invalid = uniqueIds.filter((id) => !validIds.has(id));
    if (invalid.length) {
      return NextResponse.json(
        { message: `One or more assignees are invalid.`, invalidUserIds: invalid },
        { status: 400 }
      );
    }

    // --- idempotency: a repeat submit (double-click / retry) with the same key
    // creates NOTHING and reports it as already done. The key is inserted as the
    // FIRST statement in the transaction, so a duplicate rolls the batch back
    // before any task row is written. ---
    const idemKey = String(d.idempotency_key || "").slice(0, 64) || null;
    if (idemKey) await ensureIdempotencyTable();

    conn = await getPool().getConnection();
    const created = [];
    try {
      await conn.beginTransaction();

      if (idemKey) {
        try {
          await conn.execute(
            `INSERT INTO task_bulk_imports (idempotency_key, created_by, task_count) VALUES (?, ?, ?)`,
            [idemKey, session.user.id, rows.length]
          );
        } catch (e) {
          if (e?.code === "ER_DUP_ENTRY") {
            await conn.rollback();
            return NextResponse.json(
              { message: "This paste was already submitted.", duplicate: true, created: 0 },
              { status: 200 }
            );
          }
          throw e;
        }
      }

      for (const r of rows) {
        const [res] = await conn.execute(
          `INSERT INTO tasks (title, priority, status, deadline, assigned_to_user_id, assigned_to_team_id, district_id, created_by_user_id${stampAssigned ? ", assigned_at" : ""}${hasDuration ? ", start_date, duration_preset, duration_days" : ""})
           VALUES (?, ?, 'pending', ?, ?, NULL, ?, ?${stampAssigned ? ", NOW()" : ""}${hasDuration ? ", ?, ?, ?" : ""})`,
          [r.title, priority, deadline, r.userId, districtId, session.user.id,
           ...(hasDuration ? [startDate, common.duration_preset || null, durationDays] : [])]
        );
        created.push({ taskId: res.insertId, uid: r.userId, title: r.title });
      }

      await conn.commit();
    } catch (txErr) {
      try { await conn.rollback(); } catch { /* connection may be dead */ }
      throw txErr;
    }

    // --- post-commit notifications (never block or roll back the create) ---
    for (const c of created) {
      try {
        await notifyTaskCreated({
          taskId: c.taskId,
          title: c.title,
          assignedToUserId: c.uid,
          assignedToTeamId: null,
          districtId,
          contactId: null,
          createdByUserId: session.user.id,
          createdByName: session.user.name || session.user.username || null,
        });
      } catch (e) { console.error("bulk task notify failed:", e); }
    }

    return NextResponse.json(
      { created: created.length, ids: created.map((c) => c.taskId), users: new Set(created.map((c) => c.uid)).size },
      { status: 201 }
    );
  } catch (err) {
    console.error("tasks bulk-paste error:", err?.code || "", err?.message || err);
    return NextResponse.json({ message: err?.sqlMessage || "Could not create the tasks. Please try again." }, { status: 500 });
  } finally {
    if (conn) { try { conn.release(); } catch { /* already released */ } }
  }
}
