import { query } from "@/lib/db";
import { DESIGNATION_IDS_SQL, DESIGNATION_NAMES_SQL } from "@/lib/contactDesignations";

// Resolve ONE contact into the exact shape the Contacts list renders — every
// derived display field (zone / lok sabha / district / assembly / block names,
// designation label, assigned-to username, resolved photo). Used by the update
// APIs so that after a Save the response carries the fresh, fully-resolved
// record — the client can drop its stale row data instead of keeping old names.
// This is the SINGLE source of truth every role reads, so Super Admin /
// Supervisor / Caller all see the identical updated data (no per-role copies).
export async function resolveContactCard(id) {
  const rows = await query(
    `SELECT c.*,
            u.username AS assigned_to_username,
            ld.name AS district_name,
            lw.name AS ward_name,
            COALESCE(cz.name, lz.name) AS zone_name,
            COALESCE(cls.name, lls.name) AS lok_sabha_name,
            la.name AS assembly_name,
            -- Designation display prefers the contact's OWN designation set
            -- (multi, PROMPT 5); falls back to the linked worker's position or
            -- the single legacy designation.
            COALESCE(${DESIGNATION_NAMES_SQL}, NULLIF(TRIM(w.position), ''), dsg.name) AS designation_name,
            ${DESIGNATION_IDS_SQL} AS designation_ids,
            COALESCE(c.photo_url, w.photo_url) AS photo_url
       FROM contacts c
       LEFT JOIN workers w ON w.id = c.worker_id
       LEFT JOIN users u ON u.id = c.assigned_to_user_id
       LEFT JOIN locations ld ON ld.id = c.district_id
       LEFT JOIN locations lls ON lls.id = ld.parent_id
       LEFT JOIN locations lz ON lz.id = lls.parent_id
       LEFT JOIN locations cz ON cz.id = c.zone_id
       LEFT JOIN locations cls ON cls.id = c.lok_sabha_id
       LEFT JOIN locations la ON la.id = c.assembly_id
       LEFT JOIN locations lw ON lw.id = c.ward_id
       LEFT JOIN designations dsg ON dsg.id = c.designation_id
      WHERE c.id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}
