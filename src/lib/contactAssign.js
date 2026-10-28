import { getPool, query } from "@/lib/db";
import { normalizeRole, ROLES, scopeFilterSync } from "@/lib/permissions";
import { contactsHaveAssignedAt, contactsHaveAssignedBy, zoneMatch } from "@/lib/assignmentRules";
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

// A CALLER assigns eligible contacts of THEIR OWN Zone to THEMSELVES (Zone Contacts page). The assignee is
// always the logged-in caller (never taken from the request) and the Zone is the caller's CURRENT Zone,
// read fresh by the caller (callerZoneAccess). For every requested contact, under a row lock, it must be
//   - inside that Zone (the Contact Page's own Zone definition - zoneMatch),
//   - still in the pool (unassigned - another caller's contact is never taken),
//   - not completed, and not Wrong Number / pending approval / Not Interested / 10+ Switch-Off
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
      if (Number(r.is_completed) === 1) { skipped.push({ id, reason: "completed" }); continue; }
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
    }
    await conn.commit();
    if (assigned) {
      logAudit(session, { action: "contact.self_assign", entityType: "contacts", entityId: null, details: { zone_id: zoneId, designation_id: desig, previous_assignee: null, assigned_to: me, assigned, ids: ok.slice(0, 200) } }).catch(() => {});
      emitLiveEvent(LIVE_EVENTS.CONTACT_ASSIGNED, { count: assigned });
    }
    const cnt = (r) => skipped.filter((x) => x.reason === r).length;
    const parts = [
      [cnt("already_yours"), "already assigned to you"], [cnt("already_assigned"), "assigned to another user (not changed - ask a Supervisor to reassign)"],
      [cnt("outside_zone"), "outside your Zone"], [cnt("completed"), "completed"], [cnt("not_eligible"), "not eligible"],
      [cnt("designation_mismatch"), "not holding the selected designation"],
    ].filter(([n]) => n > 0).map(([n, t]) => `${n} ${t}`);
    return {
      status: 200, assigned, assigned_ids: ok, skipped,
      message: assigned
        ? `Assigned ${assigned} contact${assigned === 1 ? "" : "s"} to you.${parts.length ? ` Not assigned: ${parts.join(", ")}.` : ""}`
        : `None of the selected contacts could be assigned${parts.length ? `: ${parts.join(", ")}` : ""}.`,
    };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}
