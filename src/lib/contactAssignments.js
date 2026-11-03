import { query } from "@/lib/db";

// Assignment record + history (one row per assignment of a contact to a caller).
//   original_zone_id   - the contact's own Zone when it was assigned (never changed by the assignment)
//   assignment_zone_id - the caller's permanent Zone at that moment (users.scope_zone_id; never changed)
//   is_temporary       - 1 when those two Zones differ: a legitimate temporary other-Zone call
// Exactly one ACTIVE row (ended_at IS NULL) per contact: assigning again closes the previous row first, so
// reassignment keeps the full history and can never leave two active assignments. contacts.assigned_to_user_id
// stays the source of truth for who owns the call; this table explains and audits it.
let ensured = null;
export function ensureContactAssignmentsSchema() {
  if (!ensured) {
    ensured = query(
      `CREATE TABLE IF NOT EXISTS contact_assignments (
         id BIGINT AUTO_INCREMENT PRIMARY KEY,
         contact_id INT NOT NULL,
         caller_id INT NOT NULL,
         original_zone_id INT NULL,
         assignment_zone_id INT NULL,
         is_temporary TINYINT(1) NOT NULL DEFAULT 0,
         assigned_by_user_id INT NULL,
         assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         ended_at DATETIME NULL,
         end_reason VARCHAR(40) NULL,
         KEY idx_ca_contact_active (contact_id, ended_at),
         KEY idx_ca_caller_active (caller_id, ended_at)
       )`
    ).catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

// Close the active record(s) of these contacts (conn = transaction connection or null for the pool).
export async function endAssignments(conn, contactIds, reason) {
  const ids = [...new Set((contactIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return;
  const ph = ids.map(() => "?").join(",");
  const sql = `UPDATE contact_assignments SET ended_at = NOW(), end_reason = ? WHERE ended_at IS NULL AND contact_id IN (${ph})`;
  if (conn) await conn.query(sql, [reason, ...ids]); else await query(sql, [reason, ...ids]);
}

// Record that these contacts are now assigned to `callerId` (closing any previous active record).
export async function recordAssignments(conn, contactIds, callerId, byUserId) {
  const ids = [...new Set((contactIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return;
  await endAssignments(conn, ids, "reassigned");
  const ph = ids.map(() => "?").join(",");
  const run = (sql, p) => (conn ? conn.query(sql, p) : query(sql, p));
  await run(
    `INSERT INTO contact_assignments (contact_id, caller_id, original_zone_id, assignment_zone_id, is_temporary, assigned_by_user_id)
     SELECT c.id, ?, z.zid, u.scope_zone_id,
            (u.scope_zone_id IS NOT NULL AND z.zid IS NOT NULL AND u.scope_zone_id <> z.zid), ?
       FROM contacts c
       JOIN users u ON u.id = ?
       LEFT JOIN (
         SELECT c2.id AS cid, COALESCE(c2.zone_id, (SELECT ls.parent_id FROM locations d JOIN locations ls ON ls.id = d.parent_id AND ls.type = 'lok_sabha' WHERE d.id = c2.district_id)) AS zid
           FROM contacts c2 WHERE c2.id IN (${ph})
       ) z ON z.cid = c.id
      WHERE c.id IN (${ph})`,
    [callerId, byUserId ?? null, callerId, ...ids, ...ids]
  );
}

// Is the contact's current assignment a deliberate (admin/supervisor) other-Zone assignment?
export async function isTemporaryAssignment(contactId) {
  const [r] = await query(
    `SELECT c.assigned_to_user_id, c.assigned_by_user_id,
            (SELECT a.is_temporary FROM contact_assignments a WHERE a.contact_id = c.id AND a.ended_at IS NULL ORDER BY a.id DESC LIMIT 1) AS rec
       FROM contacts c WHERE c.id = ?`,
    [contactId]
  ).catch(() => []);
  if (!r?.assigned_to_user_id) return false;
  if (r.rec != null && Number(r.rec) === 1) return true;
  // Legacy rows (no record): assigned by someone other than the caller themself = explicit assignment.
  return r.rec == null && r.assigned_by_user_id != null && String(r.assigned_by_user_id) !== String(r.assigned_to_user_id);
}

// Of these just-assigned contacts, how many will NOT show in the caller's My Workspace queue because of the
// existing lifecycle rules (already completed). Future follow-ups are not hidden: they sit in "Scheduled"
// until their date. Used to tell the assigner the truth instead of a bare success.
export async function completedAmong(conn, contactIds) {
  const ids = [...new Set((contactIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return 0;
  const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM contacts WHERE is_completed = 1 AND id IN (${ids.map(() => "?").join(",")})`, ids);
  return Number(rows[0]?.n || 0);
}
