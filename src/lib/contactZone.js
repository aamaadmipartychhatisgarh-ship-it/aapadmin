import { query } from "@/lib/db";
import { logAudit } from "@/lib/audit";

// A contact's Zone exactly as the Contact Page shows it: its OWN Zone when set, else
// the Zone of its district (district → Lok Sabha → Zone). Null when it has neither.
export async function contactEffectiveZoneId(contactId) {
  const [r] = await query(
    `SELECT COALESCE(c.zone_id, (
              SELECT ls.parent_id FROM locations d
                JOIN locations ls ON ls.id = d.parent_id AND ls.type = 'lok_sabha'
               WHERE d.id = c.district_id)) AS zone_id
       FROM contacts c WHERE c.id = ?`,
    [contactId]
  );
  return r?.zone_id ?? null;
}

// After a contact's Zone changed on the Contact Page: if it is still assigned to a
// caller whose Zone is a DIFFERENT one, return it to the pool, so it leaves the old
// Zone caller's work queue as well as their Zone list (callers with no Zone, and an
// assignment made in the same edit, are left alone). Only assignment fields change —
// the contact's data, call history and sentiment are untouched; no rows are created.
export async function releaseOutOfZoneAssignment(session, contactId, newZoneId) {
  const [c] = await query(
    `SELECT c.assigned_to_user_id, u.scope_zone_id, u.username FROM contacts c
       LEFT JOIN users u ON u.id = c.assigned_to_user_id WHERE c.id = ?`,
    [contactId]
  );
  if (!c?.assigned_to_user_id || !c.scope_zone_id) return null;
  if (String(c.scope_zone_id) === String(newZoneId ?? "")) return null;
  const cols = new Set((await query("SHOW COLUMNS FROM contacts")).map((r) => r.Field));
  const sets = ["assigned_to_user_id = NULL"];
  for (const k of ["assigned_at", "assigned_by_user_id", "locked_by_user_id", "locked_at"]) if (cols.has(k)) sets.push(`${k} = NULL`);
  await query(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ? AND assigned_to_user_id = ?`, [contactId, c.assigned_to_user_id]);
  logAudit(session, { action: "contact.zone_release", entityType: "contact", entityId: String(contactId), details: `Zone changed — released from caller ${c.username} (Zone #${c.scope_zone_id}) back to the pool` });
  return { caller_id: c.assigned_to_user_id, caller_name: c.username };
}
