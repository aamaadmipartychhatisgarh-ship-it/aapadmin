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

// Contacts that belong to a Zone. Contacts are keyed almost entirely by
// district_id, so a contact belongs to the Zone when its district sits under the
// Zone (directly or via a Lok Sabha) — the SAME relationship the caller's work
// queue uses (assignmentRules.zoneMatch). A contact with no district still
// belongs when its own Zone / Lok Sabha / Assembly does. No Zone → no contacts.
export function zoneContactClause(zoneId, alias = "c") {
  if (!zoneId) return { where: "AND 1 = 0", params: [] };
  const c = alias ? `${alias}.` : "";
  const byDistrict = zoneMatch(zoneId, alias); // " AND c.district_id IN (...)"
  const districtPart = byDistrict.where.replace(/^\s*AND\s+/, "");
  return {
    where: `AND (
      ${districtPart}
      OR (${c}district_id IS NULL AND (
        ${c}zone_id = ?
        OR ${c}lok_sabha_id IN (SELECT ls.id FROM locations ls WHERE ls.type = 'lok_sabha' AND ls.parent_id = ?)
        OR ${c}assembly_id IN (
          SELECT a.id FROM locations a
            JOIN locations d ON d.id = a.parent_id AND d.type = 'district'
           WHERE d.parent_id = ? OR d.parent_id IN (SELECT ls.id FROM locations ls WHERE ls.type = 'lok_sabha' AND ls.parent_id = ?))
      ))
    )`,
    params: [...byDistrict.params, zoneId, zoneId, zoneId, zoneId],
  };
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
