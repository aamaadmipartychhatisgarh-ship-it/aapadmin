import { getPool } from "@/lib/db";
import { normalizeRole, ROLES, scopeFilterSync } from "@/lib/permissions";
import { contactsHaveAssignedAt, contactsHaveAssignedBy } from "@/lib/assignmentRules";
import { notWrongNumberClause, notNotInterestedClause, notPendingClause } from "@/lib/contactExtras";
import { repeatOffExclusion } from "@/lib/repeatOff";
import { logAudit } from "@/lib/audit";
import { emitLiveEvent, LIVE_EVENTS } from "@/lib/liveEvents";

// SINGLE contact assignment (the Contacts page's per-row "Assigned to" control) - the same rules as the
// bulk Distribute (api/contacts/bulk-distribute), applied to one contact:
//   - the assignee must be an existing, active CALLER (never a free-form user id);
//   - a Wrong Number / pending-approval / Not Interested / 10+ Switch-Off contact is never assigned;
//   - the caller's geographic scope always applies;
//   - the contact row is locked for the check + write (so two clicks / an admin and a bulk run can never
//     both win), and the previous caller's lock is cleared so it leaves their queue at once;
//   - assigned_at / assigned_by_user_id are stamped exactly as bulk does.
// There is ONE assignee column on the contact, so a contact can never carry two assignments; repeating the
// same assignment changes nothing. userId null returns the contact to the pool.
// Returns { status, message, changed?, assigned_to_user_id?, previous_user_id? }.
export async function assignSingleContact(session, contactId, userId) {
  const cid = Number(contactId);
  if (!Number.isInteger(cid) || cid <= 0) return { status: 400, message: "Invalid contact." };
  const target = userId == null || userId === "" ? null : Number(userId);
  if (target !== null && (!Number.isInteger(target) || target <= 0)) return { status: 400, message: "Invalid assignee." };

  const stampAt = await contactsHaveAssignedAt();
  const stampBy = await contactsHaveAssignedBy();
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    let assignee = null;
    if (target !== null) {
      const [[u]] = await conn.query("SELECT id, role, username, is_active FROM users WHERE id = ?", [target]);
      if (!u) { await conn.rollback(); return { status: 400, message: "That user does not exist." }; }
      if (normalizeRole(u.role) !== ROLES.CALLER) { await conn.rollback(); return { status: 400, message: "Contacts can only be assigned to a caller." }; }
      if (u.is_active != null && Number(u.is_active) === 0) { await conn.rollback(); return { status: 400, message: "That caller account is disabled." }; }
      assignee = u;
    }
    // The contact, inside the caller's geographic scope (as bulk), locked for this write.
    const scope = scopeFilterSync(session.user, "c");
    const [rows] = await conn.query(`SELECT c.id, c.assigned_to_user_id FROM contacts c WHERE c.id = ? ${scope.where} FOR UPDATE`, [cid, ...scope.params]);
    const row = rows[0];
    if (!row) { await conn.rollback(); return { status: 404, message: "Contact not found." }; }
    const previous = row.assigned_to_user_id ?? null;
    if (String(previous ?? "") === String(target ?? "")) { await conn.commit(); return { status: 200, message: "Already assigned.", changed: false, assigned_to_user_id: previous }; }
    if (target !== null) {
      // The same exclusions the bulk distribution always applies.
      const excl = (await notWrongNumberClause("c")) + (await notPendingClause("c")) + (await notNotInterestedClause("c")) + (await repeatOffExclusion("c"));
      const [ok] = await conn.query(`SELECT c.id FROM contacts c WHERE c.id = ? ${excl}`, [cid]);
      if (!ok.length) {
        await conn.rollback();
        return { status: 409, message: "This contact cannot be assigned (Wrong Number, awaiting approval, Not Interested or in a 10+ Switch-Off list). Restore it first." };
      }
    }
    await conn.query(
      `UPDATE contacts SET assigned_to_user_id = ?${stampAt ? ", assigned_at = " + (target !== null ? "NOW()" : "NULL") : ""}${stampBy ? ", assigned_by_user_id = " + (target !== null ? "?" : "NULL") : ""},
              locked_by_user_id = NULL, locked_at = NULL WHERE id = ?`,
      [target, ...(stampBy && target !== null ? [session.user.id] : []), cid]
    );
    await conn.commit();
    logAudit(session, { action: target !== null ? "contact.assign" : "contact.unassign", entityType: "contact", entityId: String(cid), details: { assigned_to_user_id: target, previous_user_id: previous } }).catch(() => {});
    if (target !== null) emitLiveEvent(LIVE_EVENTS.CONTACT_ASSIGNED, { count: 1, contact_id: cid });
    return { status: 200, message: target !== null ? `Assigned to ${assignee.username}.` : "Returned to the pool.", changed: true, assigned_to_user_id: target, previous_user_id: previous };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}
