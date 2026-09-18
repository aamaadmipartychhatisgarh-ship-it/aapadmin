import { query } from "@/lib/db";
import { phoneKey, last10Sql } from "@/lib/phone";

// Find an EXISTING profile/contact photo for a mobile number — matched strictly by
// the number's last-10-digit key (never by name), so two people with similar names
// can never be confused and an unregistered number returns nothing. Reads only the
// shared photo stores already used elsewhere, in priority order:
//   1. a Contact's own photo (or its linked field-worker's photo)
//   2. a prior registration's photo (reg_people)
// Returns { photo_url, name } for the first match, else null. Creates no record and
// returns the exact stored photo — the caller never re-uploads.
export async function photoByMobile(mobile) {
  const key = phoneKey(mobile);
  if (!key || key.length !== 10) return null;
  try {
    const [c] = await query(
      `SELECT COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) AS photo_url,
              c.person_name AS name
         FROM contacts c
         LEFT JOIN workers w ON w.id = c.worker_id
        WHERE ${last10Sql("c.phone_number")} = ?
          AND COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) IS NOT NULL
        ORDER BY c.id DESC
        LIMIT 1`,
      [key]
    );
    if (c?.photo_url) return { photo_url: c.photo_url, name: c.name || null };
  } catch (e) { console.error("[photoByMobile] contacts lookup:", e?.message || e); }
  try {
    const [p] = await query(
      `SELECT photo_url, name FROM reg_people
        WHERE ${last10Sql("mobile")} = ? AND NULLIF(TRIM(photo_url), '') IS NOT NULL
        ORDER BY id DESC LIMIT 1`,
      [key]
    );
    if (p?.photo_url) return { photo_url: p.photo_url, name: p.name || null };
  } catch (e) { console.error("[photoByMobile] reg_people lookup:", e?.message || e); }
  return null;
}
