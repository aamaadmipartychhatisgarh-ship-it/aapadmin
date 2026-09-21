import { query } from "@/lib/db";
import { phoneKey, last10Sql } from "@/lib/phone";

// SCHEMA NOTE (why these SELECTs list only photo_url from `workers`)
// The photo lookups join `workers` purely for its photo_url, and must never name a
// column a given deployment's `workers` table does not have. `worker_code` is one
// of those: it is added by the membership schema patch (lib/membershipSchema.js)
// and is ABSENT on production, so selecting it raised "Unknown column
// 'w.worker_code'". Every caller wraps these lookups in try/catch, so the error
// never surfaced — it silently degraded to "no photo", which is exactly why the
// Common Form's photo slot, worker header card and top-bar chip stayed empty for
// a worker whose Contact HAS a photo, and why the collector's own photo was
// missing from the top bar. lib/membershipStats.js already treats that column as
// optional; these resolvers now simply never ask for it.
//
// The code the form shows as "Worker ID" (e.g. JASB@0018) is the REGISTRATION
// code — reg_workers.worker_code — not a `workers` column. registeredWorkerByMobile
// below resolves it, together with the Contact link that outranks a mobile match.

// Find an EXISTING profile/contact photo for a mobile number — matched strictly by
// the number's last-10-digit key (never by name), so two people with similar names
// can never be confused and an unregistered number returns nothing. Reads only the
// shared photo stores already used elsewhere, in priority order:
//   1. a Contact's own photo (or its linked field-worker's photo)
//   2. a prior registration's photo (reg_people)
// Returns { photo_url, name, contact_id } for the first match, else null.
// contact_id identifies the matched Contact so a caller can show a "who this photo
// belongs to" header; it is null for a reg_people-only match, which has no Contact
// row. Creates no record and returns the exact stored photo — never re-uploads.
export async function photoByMobile(mobile) {
  const key = phoneKey(mobile);
  if (!key || key.length !== 10) return null;
  try {
    const [c] = await query(
      `SELECT COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) AS photo_url,
              c.person_name AS name, c.id AS contact_id
         FROM contacts c
         LEFT JOIN workers w ON w.id = c.worker_id
        WHERE ${last10Sql("c.phone_number")} = ?
          AND COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) IS NOT NULL
        ORDER BY c.id DESC
        LIMIT 1`,
      [key]
    );
    if (c?.photo_url) return { photo_url: c.photo_url, name: c.name || null, contact_id: c.contact_id ?? null };
  } catch (e) { console.error("[photoByMobile] contacts lookup:", e?.message || e); }
  try {
    const [p] = await query(
      `SELECT photo_url, name FROM reg_people
        WHERE ${last10Sql("mobile")} = ? AND NULLIF(TRIM(photo_url), '') IS NOT NULL
        ORDER BY id DESC LIMIT 1`,
      [key]
    );
    if (p?.photo_url) return { photo_url: p.photo_url, name: p.name || null, contact_id: null };
  } catch (e) { console.error("[photoByMobile] reg_people lookup:", e?.message || e); }
  return null;
}

// Resolve a photo straight from a KNOWN Contact id — the strongest link, used when
// a reg_worker was generated from a Contact and carries its contact_id. Same photo
// resolution the Contacts list uses (a Contact's own photo, else its linked
// field-worker's), so the Common Form shows the EXACT image Contacts shows. Returns
// { photo_url, name, contact_id } or null (unknown id / no photo). This is why a
// worker can show their real photo even when their reg_worker mobile does not match
// the Contact's stored phone number.
export async function photoByContactId(contactId) {
  const id = Number(contactId);
  if (!Number.isInteger(id) || id <= 0) return null;
  try {
    const [c] = await query(
      `SELECT COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) AS photo_url,
              c.person_name AS name, c.id AS contact_id
         FROM contacts c
         LEFT JOIN workers w ON w.id = c.worker_id
        WHERE c.id = ?
          AND COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) IS NOT NULL
        LIMIT 1`,
      [id]
    );
    if (c?.photo_url) return { photo_url: c.photo_url, name: c.name || null, contact_id: c.contact_id ?? null };
  } catch (e) { console.error("[photoByContactId] lookup:", e?.message || e); }
  return null;
}

// The registered worker (karyakarta) behind a mobile number, when there is one.
// This is the "Worker → Contact relationship" the matching order puts ABOVE a
// plain mobile match: a reg_worker generated from a Contact carries that
// contact_id, so their real Contact photo resolves even when the number typed into
// the form is not the one stored on the Contact. It also carries the worker_code
// (JASB@0018) the form shows as "Worker ID".
//
// Matched on the last-10 key only, never by name. Restricted to active workers of
// an active drive, so a closed/disabled registration can never lend its identity.
// Returns { id, name, worker_code, contact_id } or null.
export async function registeredWorkerByMobile(mobile) {
  const key = phoneKey(mobile);
  if (!key || key.length !== 10) return null;
  try {
    const [w] = await query(
      `SELECT rw.id, rw.name, rw.worker_code, rw.contact_id
         FROM reg_workers rw
         JOIN reg_campaigns rc ON rc.id = rw.campaign_id
        WHERE ${last10Sql("rw.mobile")} = ?
          AND rw.status = 'active' AND rc.status = 'active'
        ORDER BY rw.id DESC
        LIMIT 1`,
      [key]
    );
    if (w) return { id: w.id, name: w.name || null, worker_code: w.worker_code || null, contact_id: w.contact_id ?? null };
  } catch (e) { console.error("[registeredWorkerByMobile] lookup:", e?.message || e); }
  return null;
}

// Resolve a reg_worker's photo in the priority the Contacts relationship dictates:
//   1. the reg_worker's own contact_id (a Contact generated/linked directly) — the
//      most reliable, and independent of how the mobile was typed;
//   2. the registered mobile as a fallback (matches a Contact by its phone number).
// Never by name. Returns { photo_url, name, contact_id } or null. This is the
// single resolver every karyakarta/handler photo path uses, so a worker who has a
// Contact photo never falls back to initials just because their mobile does not
// match the Contact's stored number.
export async function resolveWorkerPhoto({ contactId = null, mobile = null } = {}) {
  if (contactId) {
    const byId = await photoByContactId(contactId);
    if (byId?.photo_url) return byId;
  }
  return photoByMobile(mobile);
}
