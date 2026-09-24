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

// Find ONE contact by phone number (last-10-digit match, same normalization the
// Contacts duplicate check uses) and resolve it to the full card. Returns null
// when the phone isn't a valid 10-digit number or no contact matches — the caller
// then shows "Contact Not Found" and never creates a duplicate.
export async function resolveContactByPhone(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  const ten = digits.length >= 10 ? digits.slice(-10) : null;
  if (!ten) return null;
  const [hit] = await query(
    `SELECT id FROM contacts
      WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone_number,' ',''),'-',''),'+',''),'(',''),')',''),'.','') , 10) = ?
      LIMIT 1`,
    [ten]
  );
  if (!hit) return null;
  return resolveContactCard(hit.id);
}

// The compact "Joined By" contact snapshot the Influencer form/list/view uses. The
// LINK is the id (details are always read live from Contacts — never copied), and
// these fields are just the currently-resolved values for display.
export function compactContactCard(card) {
  if (!card) return null;
  return {
    id: card.id,
    person_name: card.person_name || null,
    phone_number: card.phone_number || null,
    photo_url: card.photo_url || null,
    assembly_id: card.assembly_id ?? null, assembly_name: card.assembly_name || null,
    district_id: card.district_id ?? null, district_name: card.district_name || null,
    lok_sabha_id: card.lok_sabha_id ?? null, lok_sabha_name: card.lok_sabha_name || null,
    zone_id: card.zone_id ?? null, zone_name: card.zone_name || null,
  };
}
