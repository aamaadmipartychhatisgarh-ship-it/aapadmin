import { query } from "@/lib/db";

// Designations aren't linked to user accounts directly — a worker's `position`
// (free text, comma-joined for multi-designation) is the only place a
// designation name is tied to a person, and only workers with a linked login
// (`workers.user_id`) can actually receive/act on an in-app task. Mirrors the
// exact position-match pattern already used for the Workers list/report
// filters (`w.position = ? OR FIND_IN_SET(?, REPLACE(w.position, ', ', ','))`).
export async function usersForDesignation(designationId) {
  if (!designationId) return [];
  const [des] = await query("SELECT name FROM designations WHERE id = ?", [designationId]);
  if (!des) return [];
  const rows = await query(
    `SELECT DISTINCT u.id, u.username FROM workers w
       JOIN users u ON u.id = w.user_id
      WHERE w.position = ? OR FIND_IN_SET(?, REPLACE(w.position, ', ', ','))`,
    [des.name, des.name]
  );
  return rows;
}

// Best-effort notification fan-out — mirrors notifyTaskAssigned's shape
// (src/lib/notify.js) but generic over any recipient list, since this
// feature notifies at three different points (verify, correct, resolve)
// with different recipients each time.
export async function notifyUsers(userIds, { type, title, body, link }) {
  try {
    const recipients = [...new Set((userIds || []).map(Number).filter(Boolean))];
    if (!recipients.length) return;
    const values = recipients.map(() => "(?, ?, 'info', ?, ?, ?, 0)").join(", ");
    const params = [];
    for (const uid of recipients) params.push(uid, type, title, body ? String(body).slice(0, 500) : null, link);
    await query(`INSERT INTO notifications (user_id, type, severity, title, body, link, is_read) VALUES ${values}`, params);
  } catch (e) {
    console.error("notifyUsers failed:", e);
  }
}
