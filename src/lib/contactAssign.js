import { getPool, query } from "@/lib/db";
import { normalizeRole, ROLES, scopeFilterSync } from "@/lib/permissions";
import { contactsHaveAssignedAt, contactsHaveAssignedBy, zoneMatch } from "@/lib/assignmentRules";
import { notWrongNumberClause, notNotInterestedClause, notPendingClause } from "@/lib/contactExtras";
import { repeatOffExclusion } from "@/lib/repeatOff";
import { logAudit } from "@/lib/audit";
import { ensureContactAssignmentsSchema, recordAssignments, endAssignments, completedAmong } from "@/lib/contactAssignments";
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
  await ensureContactAssignmentsSchema();
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
    if (target !== null) await recordAssignments(conn, [cid], target, session.user.id);
    else await endAssignments(conn, [cid], "returned_to_pool");
    const completedNote = target !== null && (await completedAmong(conn, [cid])) > 0;
    await conn.commit();
    logAudit(session, { action: target !== null ? "contact.assign" : "contact.unassign", entityType: "contact", entityId: String(cid), details: { assigned_to_user_id: target, previous_user_id: previous } }).catch(() => {});
    if (target !== null) emitLiveEvent(LIVE_EVENTS.CONTACT_ASSIGNED, { count: 1, contact_id: cid });
    return { status: 200, message: target !== null ? `Assigned to ${assignee.username}.${completedNote ? " Note: this contact is already completed, so it will not appear in their My Workspace queue." : ""}` : "Returned to the pool.", changed: true, assigned_to_user_id: target, previous_user_id: previous };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

// A CALLER assigns eligible contacts of THEIR OWN Zone to THEMSELVES (Zone Contacts page). The assignee is
// always the logged-in caller (never taken from the request) and the Zone is the caller's CURRENT Zone,
// read fresh by the caller (callerZoneAccess). For every requested contact, under a row lock, it must be
//   - inside that Zone (the Contact Page's own Zone definition - zoneMatch),
//   - still in the pool (unassigned - another caller's contact is never taken),
//   - not Wrong Number / pending approval / Not Interested / 10+ Switch-Off (a Completed status does NOT block it)
// (the same exclusions bulk Distribute applies). Everything that qualifies is assigned with the same
// stamping as bulk (assigned_at, assigned_by_user_id = the caller, locks cleared); the rest is reported
// with the reason, never changed. One assignee column = no duplicate mappings; a repeat changes nothing.
export async function selfAssignContacts(session, zoneId, contactIds, designationId = null) {
  const ids = [...new Set((Array.isArray(contactIds) ? contactIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return { status: 400, message: "Select at least one contact." };
  if (ids.length > 500) return { status: 400, message: "Select at most 500 contacts at a time." };
  if (!zoneId) return { status: 403, message: "You have no Zone assigned." };
  const me = Number(session.user.id);
  // Designation-wise pull: when a designation is chosen, only contacts that actually HOLD it (their designation set in
  // contact_designations, else the single legacy designation) are assigned - validated here, not trusted from the page.
  const desig = designationId ? Number(designationId) : null;
  if (designationId && (!Number.isInteger(desig) || desig <= 0)) return { status: 400, message: "Invalid designation." };
  if (desig) {
    const [d] = await query("SELECT id FROM designations WHERE id = ?", [desig]);
    if (!d) return { status: 400, message: "That designation does not exist." };
  }
  const stampAt = await contactsHaveAssignedAt();
  const stampBy = await contactsHaveAssignedBy();
  const excl = (await notWrongNumberClause("c")) + (await notPendingClause("c")) + (await notNotInterestedClause("c")) + (await repeatOffExclusion("c"));
  const z = zoneMatch(zoneId, "c");
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const ph = ids.map(() => "?").join(",");
    // Lock every requested row that exists, then classify.
    const [all] = await conn.query(`SELECT c.id, c.assigned_to_user_id, c.is_completed FROM contacts c WHERE c.id IN (${ph}) ORDER BY c.id FOR UPDATE`, ids);
    const [inZone] = await conn.query(`SELECT c.id FROM contacts c WHERE c.id IN (${ph}) ${z.where}`, [...ids, ...z.params]);
    const [clean] = await conn.query(`SELECT c.id FROM contacts c WHERE c.id IN (${ph}) ${excl}`, ids);
    const zoneSet = new Set(inZone.map((r) => r.id)), cleanSet = new Set(clean.map((r) => r.id));
    let holdSet = null;
    if (desig) {
      const [holders] = await conn.query(
        `SELECT c.id FROM contacts c WHERE c.id IN (${ph}) AND (c.designation_id = ? OR EXISTS (SELECT 1 FROM contact_designations cd WHERE cd.contact_id = c.id AND cd.designation_id = ?))`,
        [...ids, desig, desig]
      );
      holdSet = new Set(holders.map((r) => r.id));
    }
    const ok = [], skipped = [];
    const seen = new Set(all.map((r) => r.id));
    for (const id of ids) {
      if (!seen.has(id) || !zoneSet.has(id)) { skipped.push({ id, reason: "outside_zone" }); continue; }   // never reveal more than "not in your Zone"
      const r = all.find((x) => x.id === id);
      if (r.assigned_to_user_id != null) { skipped.push({ id, reason: String(r.assigned_to_user_id) === String(me) ? "already_yours" : "already_assigned" }); continue; }
      // A Completed status never blocks an assignment (it is the contact's calling outcome, not an assignment state):
      // the contact is assigned with its status and history untouched.
      if (!cleanSet.has(id)) { skipped.push({ id, reason: "not_eligible" }); continue; }
      if (holdSet && !holdSet.has(id)) { skipped.push({ id, reason: "designation_mismatch" }); continue; }
      ok.push(id);
    }
    let assigned = 0;
    if (ok.length) {
      const [res] = await conn.query(
        `UPDATE contacts SET assigned_to_user_id = ?${stampAt ? ", assigned_at = NOW()" : ""}${stampBy ? ", assigned_by_user_id = ?" : ""},
                locked_by_user_id = NULL, locked_at = NULL
          WHERE id IN (${ok.map(() => "?").join(",")}) AND assigned_to_user_id IS NULL`,
        [me, ...(stampBy ? [me] : []), ...ok]
      );
      assigned = res.affectedRows || 0;
      // Assignment history, exactly like an Admin / Supervisor assignment (closes any open record, opens this one).
      if (assigned) await recordAssignments(conn, ok, me, me);
    }
    const completedTaken = ok.filter((id) => Number(all.find((x) => x.id === id)?.is_completed) === 1).length;
    await conn.commit();
    if (assigned) {
      logAudit(session, { action: "contact.self_assign", entityType: "contacts", entityId: null, details: { zone_id: zoneId, designation_id: desig, previous_assignee: null, assigned_to: me, assigned, ids: ok.slice(0, 200) } }).catch(() => {});
      emitLiveEvent(LIVE_EVENTS.CONTACT_ASSIGNED, { count: assigned });
    }
    const cnt = (r) => skipped.filter((x) => x.reason === r).length;
    const parts = [
      [cnt("already_yours"), "already assigned to you"], [cnt("already_assigned"), "assigned to another user (not changed - ask a Supervisor to reassign)"],
      [cnt("outside_zone"), "outside your Zone"], [cnt("not_eligible"), "not eligible"],
      [cnt("designation_mismatch"), "not holding the selected designation"],
    ].filter(([n]) => n > 0).map(([n, t]) => `${n} ${t}`);
    return {
      status: 200, assigned, assigned_ids: ok, skipped,
      message: assigned
        ? `Assigned ${assigned} contact${assigned === 1 ? "" : "s"} to you.${completedTaken ? ` ${completedTaken} of them ${completedTaken === 1 ? "is" : "are"} already Completed: ${completedTaken === 1 ? "it stays" : "they stay"} Completed (history kept) and ${completedTaken === 1 ? "is" : "are"} listed here under "Assigned to you", not in your calling queue.` : ""}${parts.length ? ` Not assigned: ${parts.join(", ")}.` : ""}`
        : `None of the selected contacts could be assigned${parts.length ? `: ${parts.join(", ")}` : ""}.`,
    };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

// A CALLER removes contacts from THEIR OWN assignment (Zone Contacts -> Remove Assignment, single or bulk). It only ever clears the
// assignment relationship on contacts.assigned_to_user_id = the logged-in caller:
//   - each requested contact is row-locked and re-checked INSIDE its own transaction, and the UPDATE is conditional on
//     assigned_to_user_id still being this caller, so another caller's (or a reassigned) contact is never touched, and a repeated /
//     concurrent request removes it at most once;
//   - only assigned_to_user_id / assigned_at / assigned_by_user_id and this caller's own lock are cleared. The contact's details, Zone /
//     Assembly mapping, calls, remarks and follow-ups are not touched, and nothing is deleted;
//   - the active assignment record is closed (history kept) and the removal is audit-logged;
//   - every contact gets its own outcome, so a partial failure is reported exactly (removed / skipped with a reason / failed).
export async function removeOwnAssignments(session, contactIds) {
  const me = Number(session.user.id);
  const ids = [...new Set((Array.isArray(contactIds) ? contactIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return { status: 400, message: "Select at least one contact." };
  if (ids.length > 500) return { status: 400, message: "Select at most 500 contacts at a time." };
  await ensureContactAssignmentsSchema();
  const stampAt = await contactsHaveAssignedAt();
  const stampBy = await contactsHaveAssignedBy();
  const removed = [], skipped = [], failed = [];
  for (const id of ids) {
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const [[row]] = await conn.query("SELECT id, assigned_to_user_id FROM contacts WHERE id = ? FOR UPDATE", [id]);
      if (!row) { await conn.rollback(); skipped.push({ id, reason: "not_found" }); continue; }
      if (row.assigned_to_user_id == null) { await conn.rollback(); skipped.push({ id, reason: "not_assigned" }); continue; }
      if (Number(row.assigned_to_user_id) !== me) { await conn.rollback(); skipped.push({ id, reason: "not_yours" }); continue; }
      const [res] = await conn.query(
        `UPDATE contacts SET assigned_to_user_id = NULL${stampAt ? ", assigned_at = NULL" : ""}${stampBy ? ", assigned_by_user_id = NULL" : ""},
                locked_by_user_id = IF(locked_by_user_id = ?, NULL, locked_by_user_id), locked_at = IF(locked_by_user_id = ?, NULL, locked_at)
          WHERE id = ? AND assigned_to_user_id = ?`,
        [me, me, id, me]
      );
      if (res.affectedRows !== 1) { await conn.rollback(); skipped.push({ id, reason: "not_yours" }); continue; }
      await endAssignments(conn, [id], "removed_by_caller");
      await conn.commit();
      removed.push(id);
    } catch (e) {
      await conn.rollback().catch(() => {});
      console.error("remove assignment failed for", id, e?.message || e);
      failed.push({ id, reason: "error" });
    } finally { conn.release(); }
  }
  if (removed.length) {
    logAudit(session, { action: "contact.assignment_removed_by_caller", entityType: "contacts", entityId: null, details: { removed: removed.length, ids: removed.slice(0, 200), caller_id: me } }).catch(() => {});
    emitLiveEvent(LIVE_EVENTS.CONTACT_ASSIGNED, { count: removed.length });
  }
  const cnt = (r) => skipped.filter((x) => x.reason === r).length;
  const parts = [[cnt("not_yours"), "not assigned to you"], [cnt("not_assigned"), "not assigned to anyone"], [cnt("not_found"), "not found"], [failed.length, "failed (nothing changed for them - try again)"]]
    .filter(([n]) => n > 0).map(([n, t]) => `${n} ${t}`);
  return {
    status: 200, removed: removed.length, removed_ids: removed, skipped, failed,
    message: removed.length
      ? `Removed ${removed.length} assignment${removed.length === 1 ? "" : "s"}${parts.length ? `; not removed: ${parts.join(", ")}.` : "."}`
      : `No assignment was removed${parts.length ? `: ${parts.join(", ")}` : ""}.`,
  };
}
