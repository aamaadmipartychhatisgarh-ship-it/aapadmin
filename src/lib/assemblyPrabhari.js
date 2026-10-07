import { query } from "@/lib/db";
import { notWrongNumberClause, notPendingClause } from "@/lib/contactExtras";
import { ensureContactDesignationsSchema } from "@/lib/contactDesignations";

// The Vidhansabha (Assembly) Prabhari of every master assembly, resolved from the
// EXISTING designation relationships — never by name text alone, never a random
// contact. Two sources, in priority order:
//
//   1. A FINAL-APPROVED designation assignment (the Designation Approvals chain)
//      whose designation is the Vidhansabha Prabhari and whose assembly is this
//      assembly — the authoritative organisational record. Newest approval wins.
//   2. Otherwise a live Contact located in this assembly that holds the
//      Vidhansabha Prabhari designation (contact_designations, or the legacy
//      single designation_id) — the Designation Master link.
//
// The photo is the person's OWN profile photo from the existing storage: the
// contact's photo_url, else the linked field-worker's, else (source 1 only) the
// photo snapshot taken when the designation was assigned. Nothing else — a
// missing photo stays null so the UI shows its initials placeholder.

// "Vidhansabha Prabhari" as it appears in the Designation Master, in any of its
// spellings, excluding the deputy ("Seh/Sah Prabhari").
const PRABHARI_MATCH = `(LOWER(%s) REGEXP '(vidhan ?sabha|vidhansbha|vidhansbaha|assembly).*prabhari'
   AND LOWER(%s) NOT REGEXP '(seh|sah|sah-)[ -]?prabhari')`;
const nameMatch = (col) => PRABHARI_MATCH.replace(/%s/g, col);

const PHOTO = "COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), ''))";

// Returns Map<assembly_location_id, { name, photo_url, contact_id, source }>.
export async function prabhariByAssembly() {
  const out = new Map();
  await ensureContactDesignationsSchema();
  const liveContact = (await notWrongNumberClause("c")) + (await notPendingClause("c"));

  // 2 (lower priority — written first so source 1 overrides): Designation Master link.
  try {
    const rows = await query(
      `SELECT c.assembly_id, c.id AS contact_id, c.person_name, ${PHOTO} AS photo_url
         FROM contacts c
         LEFT JOIN workers w ON w.id = c.worker_id
         JOIN designations d
           ON d.id = c.designation_id
           OR d.id IN (SELECT cd.designation_id FROM contact_designations cd WHERE cd.contact_id = c.id)
        WHERE c.assembly_id IS NOT NULL
          AND ${nameMatch("d.name")}
          ${liveContact}
        ORDER BY c.assembly_id, (d.\`rank\` IS NULL), d.\`rank\`, c.id`
    ).catch(async (e) => {
      // Older master without the rank column: same query without that order key.
      if (!/rank/i.test(e?.message || "")) throw e;
      return query(
        `SELECT c.assembly_id, c.id AS contact_id, c.person_name, ${PHOTO} AS photo_url
           FROM contacts c
           LEFT JOIN workers w ON w.id = c.worker_id
           JOIN designations d
             ON d.id = c.designation_id
             OR d.id IN (SELECT cd.designation_id FROM contact_designations cd WHERE cd.contact_id = c.id)
          WHERE c.assembly_id IS NOT NULL AND ${nameMatch("d.name")} ${liveContact}
          ORDER BY c.assembly_id, c.id`
      );
    });
    for (const r of rows) {
      const k = Number(r.assembly_id);
      if (!out.has(k)) out.set(k, { name: r.person_name, photo_url: r.photo_url || null, contact_id: r.contact_id, source: "designation" });
    }
  } catch (e) {
    console.error("[assembly prabhari] designation lookup:", e?.message || e);
  }

  // 1: final-approved designation assignments (authoritative).
  try {
    const rows = await query(
      `SELECT da.assembly_id, da.member_id, da.member_name,
              COALESCE(${PHOTO}, NULLIF(TRIM(da.member_photo_url), '')) AS photo_url,
              COALESCE(NULLIF(TRIM(c.person_name), ''), da.member_name) AS name
         FROM designation_assignments da
         LEFT JOIN contacts c ON c.id = da.member_id
         LEFT JOIN workers w ON w.id = c.worker_id
        WHERE da.status = 'final_approved'
          AND da.assembly_id IS NOT NULL
          AND ${nameMatch("da.designation_name")}
        ORDER BY da.assembly_id, da.final_approved_at DESC, da.id DESC`
    );
    const seen = new Set();
    for (const r of rows) {
      const k = Number(r.assembly_id);
      if (seen.has(k)) continue;
      seen.add(k);
      out.set(k, { name: r.name, photo_url: r.photo_url || null, contact_id: r.member_id || null, source: "approval" });
    }
  } catch (e) {
    // No approvals table on this deployment → the Designation Master link stands.
    if (!/doesn't exist|ER_NO_SUCH_TABLE/i.test(e?.message || e?.code || "")) console.error("[assembly prabhari] approvals lookup:", e?.message || e);
  }
  return out;
}
