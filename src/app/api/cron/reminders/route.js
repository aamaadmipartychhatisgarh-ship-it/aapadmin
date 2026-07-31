import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

// Reminders sweep — meant to be hit by a scheduled cron (see below), but also
// runnable manually by an admin. Creates in-app notifications for:
//   • Tasks due today / overdue (to the assignee)
//   • Follow-ups due today / overdue (to the assigned caller)
// All dates are in the application timezone (Asia/Kolkata). De-duplicated so a
// given task/contact only produces ONE reminder per user per day. Everything is
// set-based (INSERT ... SELECT) — no per-row loop, scales to thousands.
//
// Hostinger cron (run every morning ~08:00 IST = 02:30 UTC):
//   30 2 * * *  curl -s "https://YOUR_DOMAIN/api/cron/reminders?key=YOUR_CRON_SECRET"
// Set CRON_SECRET in the environment. If unset, only a signed-in admin may run it.
export const dynamic = "force-dynamic";

const IST = "+05:30";
const IST_TODAY = `DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','${IST}'))`;
const NOTIF_DAY = `DATE(CONVERT_TZ(n.created_at,'+00:00','${IST}'))`;

async function authorize(req) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const key = url.searchParams.get("key") || req.headers.get("x-cron-key");
    if (key && key === secret) return true;
  }
  // Fallback: an authenticated admin can trigger it by hand.
  const session = await getServerSession(authOptions);
  return !!(session && isAdmin(session));
}

export async function GET(req) {
  try {
    if (!(await authorize(req))) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    // --- Task reminders ---
    const taskRes = await query(
      `INSERT INTO notifications (user_id, type, severity, title, body, link, is_read)
       SELECT t.assigned_to_user_id, 'task_due',
              CASE WHEN t.deadline < ${IST_TODAY} THEN 'critical' ELSE 'warning' END,
              CASE WHEN t.deadline < ${IST_TODAY} THEN 'Task overdue' ELSE 'Task due today' END,
              CONCAT(t.title, ' — due ', DATE_FORMAT(t.deadline, '%d %b %Y')),
              CONCAT('/dashboard/tasks?task=', t.id), 0
         FROM tasks t
        WHERE t.status IN ('pending','in_progress')
          AND t.assigned_to_user_id IS NOT NULL
          AND t.deadline IS NOT NULL AND t.deadline <= ${IST_TODAY}
          AND NOT EXISTS (
            SELECT 1 FROM notifications n
             WHERE n.user_id = t.assigned_to_user_id AND n.type = 'task_due'
               AND n.link = CONCAT('/dashboard/tasks?task=', t.id)
               AND ${NOTIF_DAY} = ${IST_TODAY})`
    );

    // --- Follow-up reminders (skip wrong numbers) ---
    const hasWrong = await query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='contacts' AND COLUMN_NAME='is_wrong_number'`
    ).then((r) => Number(r[0]?.n || 0) > 0).catch(() => false);
    const notWrong = hasWrong ? " AND (c.is_wrong_number = 0 OR c.is_wrong_number IS NULL)" : "";

    const fupRes = await query(
      `INSERT INTO notifications (user_id, type, severity, title, body, link, is_read)
       SELECT c.assigned_to_user_id, 'followup_due',
              CASE WHEN c.follow_up_date < ${IST_TODAY} THEN 'critical' ELSE 'warning' END,
              CASE WHEN c.follow_up_date < ${IST_TODAY} THEN 'Follow-up overdue' ELSE 'Follow-up due today' END,
              CONCAT('Call back ', COALESCE(c.person_name, c.phone_number), ' — ', DATE_FORMAT(c.follow_up_date, '%d %b %Y')),
              CONCAT('/dashboard/workspace?c=', c.id), 0
         FROM contacts c
        WHERE c.assigned_to_user_id IS NOT NULL
          AND c.is_completed = 0
          AND c.follow_up_date IS NOT NULL AND c.follow_up_date <= ${IST_TODAY}
          ${notWrong}
          AND NOT EXISTS (
            SELECT 1 FROM notifications n
             WHERE n.user_id = c.assigned_to_user_id AND n.type = 'followup_due'
               AND n.link = CONCAT('/dashboard/workspace?c=', c.id)
               AND ${NOTIF_DAY} = ${IST_TODAY})`
    );

    return NextResponse.json({
      ok: true,
      task_reminders: taskRes.affectedRows || 0,
      followup_reminders: fupRes.affectedRows || 0,
    });
  } catch (err) {
    console.error("cron reminders error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
