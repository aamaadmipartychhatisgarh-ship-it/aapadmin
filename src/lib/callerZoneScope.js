import { query } from "@/lib/db";
import { normalizeRole, ROLES } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { zoneMatch } from "@/lib/assignmentRules";
import { callerOwnsContact } from "@/lib/callerContactAccess";

// CALLER ZONE CONTACTS — a caller may VIEW every contact of the Zone they are
// currently assigned (users.scope_zone_id, set by an Admin), read-only. This is
// the one rule every caller-facing Contact read uses (list, record, call
// history), so it can't drift between endpoints. Editing stays exactly as before
// (only a contact the caller holds / is assigned / has called — callerContactAccess).
//
// The Zone is read FRESH from the users table on every request (not from the
// login token), so when an Admin moves a caller to another Zone the new Zone's
// contacts appear and the old Zone's disappear on the very next request — no
// re-login, no stale permission.

// Page-access key for the caller's Contacts page (lib/pages.js).
export const CALLER_ZONE_CONTACTS_PAGE = "zone_contacts";

// Contacts that belong to a Zone — exactly the Zone the Contact Page shows for the
// contact (its own Zone, else its district's Zone; see assignmentRules.zoneMatch),
// so the caller's list can never drift from the Contact Page. No Zone → no contacts.
export function zoneContactClause(zoneId, alias = "c") {
  if (!zoneId) return { where: "AND 1 = 0", params: [] };
  return zoneMatch(zoneId, alias);
}

// For a CALLER with access to the Zone Contacts page: { zoneId } (zoneId may be
// null when no Zone is assigned). null for every other role — they keep their
// existing Contact access untouched.
export async function callerZoneAccess(session) {
  if (!session?.user || normalizeRole(session.user.role) !== ROLES.CALLER) return null;
  if (!(await pageAllowed(session, CALLER_ZONE_CONTACTS_PAGE, true))) return null;
  const [u] = await query("SELECT scope_zone_id FROM users WHERE id = ?", [session.user.id]);
  return { zoneId: u?.scope_zone_id ?? null };
}

export async function contactInZone(contactId, zoneId) {
  if (!zoneId) return false;
  const z = zoneContactClause(zoneId, "c");
  const rows = await query(`SELECT 1 FROM contacts c WHERE c.id = ? ${z.where} LIMIT 1`, [contactId, ...z.params]);
  return rows.length > 0;
}

// May this caller READ the contact (record / call history)? Their own working
// contact, or any contact of their current Zone.
export async function callerCanReadContact(session, contactId, userId) {
  if (await callerOwnsContact(contactId, userId)) return true;
  const zone = await callerZoneAccess(session);
  return !!zone && (await contactInZone(contactId, zone.zoneId));
}
