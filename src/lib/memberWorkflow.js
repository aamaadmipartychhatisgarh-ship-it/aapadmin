import { query } from "@/lib/db";
import { MEMBER_DESIGNATION } from "@/lib/memberWorkflowShared";
export * from "@/lib/memberWorkflowShared";

// Does this contact hold the "Member" designation? Decided from its DESIGNATION SET (contact_designations - the authority, the one the
// Contact forms and the workspace card show); only a contact with NO designation set falls back to the legacy single contacts.designation_id.
// (This used to OR the two: a contact whose legacy column still said Member but whose set was something else was treated as a Member
// here while the workspace showed it - correctly - as a regular contact, so a perfectly valid regular status / sentiment was rejected with
// a Member-only message.) The workspace uses the SAME rule, so the options shown and the rules applied can never disagree.
export async function isMemberContact(contactId) {
  if (!contactId) return false;
  const rows = await query(
    `SELECT 1 AS ok FROM designations d
      WHERE LOWER(TRIM(d.name)) = ?
        AND (d.id IN (SELECT cd.designation_id FROM contact_designations cd WHERE cd.contact_id = ?)
             OR (NOT EXISTS (SELECT 1 FROM contact_designations cx WHERE cx.contact_id = ?)
                 AND d.id = (SELECT c.designation_id FROM contacts c WHERE c.id = ?)))
      LIMIT 1`,
    [MEMBER_DESIGNATION, contactId, contactId, contactId]
  );
  return rows.length > 0;
}
