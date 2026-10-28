import { query } from "@/lib/db";
import { MEMBER_DESIGNATION } from "@/lib/memberWorkflowShared";
export * from "@/lib/memberWorkflowShared";

// Does this contact hold the "Member" designation (its designation set, else the single legacy designation)?
export async function isMemberContact(contactId) {
  if (!contactId) return false;
  const rows = await query(
    `SELECT 1 AS ok FROM designations d
      WHERE LOWER(TRIM(d.name)) = ?
        AND (d.id = (SELECT c.designation_id FROM contacts c WHERE c.id = ?)
             OR d.id IN (SELECT cd.designation_id FROM contact_designations cd WHERE cd.contact_id = ?))
      LIMIT 1`,
    [MEMBER_DESIGNATION, contactId, contactId]
  );
  return rows.length > 0;
}
