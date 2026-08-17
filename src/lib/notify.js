import { query } from "@/lib/db";

// Fan a "new task" popup out to the assigned caller(s) AND the relevant
// supervisor(s), by writing rows into the `notifications` table (the same feed
// TaskNotifier polls, so both see a popup with no page refresh). Best-effort:
// any failure is logged and swallowed so it never blocks or rolls back the task
// write — it only runs AFTER the task has been committed.
//
// Recipients:
//   - the assigned caller, and every member of an assigned team;
//   - supervisors whose territory covers the task's district (or, if the task
//     has no district, the assignee's home district).
// The creator is excluded, and the recipient set is de-duplicated so nobody is
// notified twice — even if they are both an assignee and the covering supervisor.
export async function notifyTaskCreated({
  taskId, title, assignedToUserId, assignedToTeamId, districtId, contactId,
  createdByUserId, createdByName,
}) {
  try {
    // 1. Assigned caller(s): the direct assignee + any team members.
    const recipients = new Set();
    if (assignedToUserId) recipients.add(Number(assignedToUserId));
    if (assignedToTeamId) {
      const members = await query(
        "SELECT DISTINCT user_id FROM team_members WHERE team_id = ? AND user_id IS NOT NULL",
        [assignedToTeamId]
      );
      members.forEach((m) => recipients.add(Number(m.user_id)));
    }

    // 2. District to target supervisors by: the task's district, else the
    //    assignee's home district.
    let did = districtId ? Number(districtId) : null;
    if (!did && assignedToUserId) {
      const u = await query("SELECT home_district_id FROM users WHERE id = ?", [assignedToUserId]);
      did = u[0]?.home_district_id ? Number(u[0].home_district_id) : null;
    }

    // 3. Relevant supervisors: active supervisors whose scope covers that
    //    district (their own district, their zone, or the district owning their
    //    assembly). Uses IDs/foreign keys — no name matching.
    if (did) {
      const sups = await query(
        `SELECT id FROM users
          WHERE role = 'supervisor' AND is_active = 1
            AND ( home_district_id = ?
               OR (scope_zone_id IS NOT NULL AND scope_zone_id = (
                     SELECT lz.id FROM locations ld
                       JOIN locations lls ON lls.id = ld.parent_id
                       JOIN locations lz  ON lz.id  = lls.parent_id
                      WHERE ld.id = ?))
               OR (scope_assembly_id IS NOT NULL
                   AND (SELECT parent_id FROM locations WHERE id = scope_assembly_id) = ?) )`,
        [did, did, did]
      );
      sups.forEach((s) => recipients.add(Number(s.id)));
    }

    // 4. Never notify the creator; bail if nobody is left.
    if (createdByUserId) recipients.delete(Number(createdByUserId));
    if (recipients.size === 0) return;

    // 5. Enrich the body: contact/person name + who created it. The time comes
    //    from the row's created_at (shown by the notifier).
    let contactName = null;
    if (contactId) {
      const c = await query("SELECT person_name FROM contacts WHERE id = ?", [contactId]);
      contactName = c[0]?.person_name || null;
    }
    const bodyParts = [];
    if (contactName) bodyParts.push(`Contact: ${contactName}`);
    if (createdByName) bodyParts.push(`Created by ${createdByName}`);
    const body = bodyParts.length ? bodyParts.join(" · ").slice(0, 500) : null;
    const notifTitle = `New Task: ${title}`.slice(0, 255);
    const link = "/dashboard/tasks";

    const values = [...recipients].map(() => "(?, 'task_assigned', 'info', ?, ?, ?, 0)").join(", ");
    const params = [];
    for (const uid of recipients) params.push(uid, notifTitle, body, link);
    await query(
      `INSERT INTO notifications (user_id, type, severity, title, body, link, is_read) VALUES ${values}`,
      params
    );
  } catch (e) {
    console.error("notifyTaskCreated failed:", e);
  }
}

// Backwards-compatible alias for the previous caller-only helper.
export const notifyTaskAssigned = notifyTaskCreated;
