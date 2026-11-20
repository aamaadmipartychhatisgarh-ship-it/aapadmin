import { query } from "@/lib/db";
import { isOversight, isCaller, scopeFilterSync } from "@/lib/permissions";

// WHO MAY SEE WHICH COMPLAINT — the one rule every complaint read and write uses (list, counts, type breakdown, detail,
// export, update, delete), so they can never disagree.
//
//   • A CALLER sees ONLY the complaints assigned to their own user id (complaints.assigned_user_id). The id is taken from the
//     authenticated session on the server — never from the request — so changing a URL, a query parameter or a complaint id
//     cannot reach anyone else's complaint (it reads as "not found").
//   • Everyone else (Admin, Supervisor, other oversight roles, or a user granted the page) keeps EXACTLY the geographic scope
//     they had before (district / assembly).
//
// A complaint logged by a Caller is assigned to that Caller; Admins / Supervisors can reassign it (history in
// complaint_assignments). Reassigning moves it out of the previous Caller's list and into the new Caller's at once.
export function isCallerOnly(session) {
  return !!session?.user && isCaller(session) && !isOversight(session);
}

// { where: "AND …" | "", params: [] } for a query aliased `c` (complaints).
export function complaintScope(session, alias = "c") {
  if (isCallerOnly(session)) {
    const me = Number(session.user.id);
    if (!Number.isInteger(me) || me <= 0) return { where: "AND 1 = 0", params: [] };
    return { where: `AND ${alias}.assigned_user_id = ?`, params: [me] };
  }
  return scopeFilterSync(session.user, alias, { cols: ["district_id", "assembly_id"] });
}

// Is complaint `id` visible to this user (same rule as the list)? Used before every single-complaint read / change.
export async function complaintVisible(session, id) {
  const cid = Number(id);
  if (!Number.isInteger(cid) || cid <= 0) return false;
  const s = complaintScope(session, "c");
  const [r] = await query(`SELECT c.id FROM complaints c WHERE c.id = ? ${s.where || ""} LIMIT 1`, [cid, ...s.params]);
  return !!r;
}

// Assignment columns + history (additive, idempotent; nothing existing is changed).
let ensured = false;
export async function ensureComplaintAssignmentSchema() {
  if (ensured) return;
  const cols = new Set((await query(
    "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'complaints'"
  )).map((r) => r.c));
  if (!cols.has("assigned_user_id")) await query("ALTER TABLE complaints ADD COLUMN assigned_user_id INT NULL, ADD KEY idx_complaints_assigned_user (assigned_user_id)");
  if (!cols.has("assigned_at")) await query("ALTER TABLE complaints ADD COLUMN assigned_at DATETIME NULL");
  if (!cols.has("created_by_user_id")) await query("ALTER TABLE complaints ADD COLUMN created_by_user_id INT NULL");
  // Last Updated: set on every change of the row (status, notes, reassignment …); existing rows start from their created time.
  if (!cols.has("updated_at")) {
    await query("ALTER TABLE complaints ADD COLUMN updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP");
    await query("UPDATE complaints SET updated_at = COALESCE(resolved_at, created_at) WHERE updated_at IS NULL");
  }
  await query(`CREATE TABLE IF NOT EXISTS complaint_assignments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    complaint_id INT NOT NULL,
    from_user_id INT NULL,
    to_user_id INT NULL,
    changed_by INT NULL,
    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_ca_complaint (complaint_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  ensured = true;
}

// The users a complaint may be assigned to: active Callers.
export async function assignableComplaintUsers() {
  return query("SELECT id, username FROM users WHERE role = 'caller' AND (is_active IS NULL OR is_active = 1) ORDER BY username");
}

// Record an assignment change (the complaint row itself is updated by the caller of this function).
export async function logComplaintAssignment(complaintId, fromUserId, toUserId, changedBy) {
  await query("INSERT INTO complaint_assignments (complaint_id, from_user_id, to_user_id, changed_by) VALUES (?, ?, ?, ?)",
    [complaintId, fromUserId ?? null, toUserId ?? null, changedBy ?? null]);
}
