import { query } from "@/lib/db";

// Writes rows into the `notifications` table so an assigned caller is alerted.
// Best-effort: any failure is logged and swallowed so it never blocks the task
// write. A task assigned to a team fans out to every user on that team.
export async function notifyTaskAssigned({ taskId, title, description, assignedToUserId, assignedToTeamId, excludeUserId }) {
  try {
    const recipients = new Set();
    if (assignedToUserId) recipients.add(Number(assignedToUserId));
    if (assignedToTeamId) {
      const members = await query(
        "SELECT DISTINCT user_id FROM team_members WHERE team_id = ? AND user_id IS NOT NULL",
        [assignedToTeamId]
      );
      members.forEach((m) => recipients.add(Number(m.user_id)));
    }
    if (excludeUserId) recipients.delete(Number(excludeUserId));
    if (recipients.size === 0) return;

    const body = description ? String(description).slice(0, 500) : null;
    const link = "/dashboard/tasks";
    const values = [...recipients].map(() => "(?, 'task_assigned', 'info', ?, ?, ?, 0)").join(", ");
    const params = [];
    for (const uid of recipients) {
      params.push(uid, `New task: ${title}`, body, link);
    }
    await query(
      `INSERT INTO notifications (user_id, type, severity, title, body, link, is_read) VALUES ${values}`,
      params
    );
  } catch (e) {
    console.error("notifyTaskAssigned failed:", e);
  }
}
