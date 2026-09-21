import { query } from "@/lib/db";
import { phoneKey, last10Sql } from "@/lib/phone";

// Find an EXISTING profile/contact photo for a mobile number — matched strictly by
// the number's last-10-digit key (never by name), so two people with similar names
// can never be confused and an unregistered number returns nothing. Reads only the
// shared photo stores already used elsewhere, in priority order:
//   1. a Contact's own photo (or its linked field-worker's photo)
//   2. a prior registration's photo (reg_people)
// Returns { photo_url, name, contact_id, worker_code } for the first match, else
// null. contact_id / worker_code identify the matched Contact (and its linked
// field-worker, if any) so a caller can show a "who this photo belongs to" header;
// they are null for a reg_people-only match, which has no Contact row. Creates no
// record and returns the exact stored photo — the caller never re-uploads.
export async function photoByMobile(mobile) {
  const key = phoneKey(mobile);
  if (!key || key.length !== 10) return null;
  try {
    const [c] = await query(
      `SELECT COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) AS photo_url,
              c.person_name AS name, c.id AS contact_id, w.worker_code AS worker_code
         FROM contacts c
         LEFT JOIN workers w ON w.id = c.worker_id
        WHERE ${last10Sql("c.phone_number")} = ?
          AND COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) IS NOT NULL
        ORDER BY c.id DESC
        LIMIT 1`,
      [key]
    );
    if (c?.photo_url) return { photo_url: c.photo_url, name: c.name || null, contact_id: c.contact_id ?? null, worker_code: c.worker_code || null };
  } catch (e) { console.error("[photoByMobile] contacts lookup:", e?.message || e); }
  try {
    const [p] = await query(
      `SELECT photo_url, name FROM reg_people
        WHERE ${last10Sql("mobile")} = ? AND NULLIF(TRIM(photo_url), '') IS NOT NULL
        ORDER BY id DESC LIMIT 1`,
      [key]
    );
    if (p?.photo_url) return { photo_url: p.photo_url, name: p.name || null, contact_id: null, worker_code: null };
  } catch (e) { console.error("[photoByMobile] reg_people lookup:", e?.message || e); }
  return null;
}

// Resolve a photo straight from a KNOWN Contact id — the strongest link, used when
// a reg_worker was generated from a Contact and carries its contact_id. Same photo
// resolution the Contacts list uses (a Contact's own photo, else its linked
// field-worker's), so the Common Form shows the EXACT image Contacts shows. Returns
// { photo_url, name, contact_id, worker_code } or null (unknown id / no photo). This
// is why a worker can show their real photo even when their reg_worker mobile does
// not match the Contact's stored phone number.
export async function photoByContactId(contactId) {
  const id = Number(contactId);
  if (!Number.isInteger(id) || id <= 0) return null;
  try {
    const [c] = await query(
      `SELECT COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) AS photo_url,
              c.person_name AS name, c.id AS contact_id, w.worker_code AS worker_code
         FROM contacts c
         LEFT JOIN workers w ON w.id = c.worker_id
        WHERE c.id = ?
          AND COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) IS NOT NULL
        LIMIT 1`,
      [id]
    );
    if (c?.photo_url) return { photo_url: c.photo_url, name: c.name || null, contact_id: c.contact_id ?? null, worker_code: c.worker_code || null };
  } catch (e) { console.error("[photoByContactId] lookup:", e?.message || e); }
  return null;
}

// Resolve a reg_worker's photo in the priority the Contacts relationship dictates:
//   1. the reg_worker's own contact_id (a Contact generated/linked directly) — the
//      most reliable, and independent of how the mobile was typed;
//   2. the registered mobile as a fallback (matches a Contact by its phone number).
// Never by name. Returns { photo_url, name, contact_id, worker_code } or null. This
// is the single resolver every karyakarta/handler photo path uses, so a worker who
// has a Contact photo never falls back to initials just because their mobile does
// not match the Contact's stored number.
export async function resolveWorkerPhoto({ contactId = null, mobile = null } = {}) {
  if (contactId) {
    const byId = await photoByContactId(contactId);
    if (byId?.photo_url) return byId;
  }
  return photoByMobile(mobile);
}
