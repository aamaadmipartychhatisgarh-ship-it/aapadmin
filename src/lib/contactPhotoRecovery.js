import { query } from "@/lib/db";
import { last10Sql, phoneKey } from "@/lib/phone";
import { checkUploadExists } from "@/lib/mediaFileStore";

// CONTACT PHOTO RECOVERY & VERIFICATION.
//
// Many contacts have a photo REFERENCE whose file is missing (legacy disk-only
// uploads lost on redeploy), while OTHER contacts have a perfectly good photo that
// simply isn't linked to their own row (it lives on the linked worker, or in a past
// registration). This recovers the real image wherever its file still exists and
// records, per contact, whether a retrievable photo actually exists — so the count
// and the Photo Data page reflect real photos, not just a populated DB field.
//
// It NEVER deletes a file, never blanks a valid photo, and never resets references
// in bulk: it only (a) reconnects a contact's own photo_url to an existing valid
// file when its own is empty/dead, and (b) sets contacts.photo_verified (1 = a
// retrievable photo exists, 0 = none found anywhere; NULL/unknown left untouched on
// a transient lookup error).

let ensured = false;
export async function ensurePhotoVerifiedColumn() {
  if (ensured) return;
  try {
    const cols = await query("SHOW COLUMNS FROM contacts LIKE 'photo_verified'");
    if (!cols.length) await query("ALTER TABLE contacts ADD COLUMN photo_verified TINYINT NULL");
    ensured = true;
  } catch (e) {
    console.error("[photoRecovery] ensure column:", e?.message || e);
  }
}

// A prior registration's photo for a mobile (reg_people) — a source NOT covered by
// the contact/worker COALESCE, so it recovers photos uploaded during registration.
async function regPhotoByMobile(mobile) {
  const key = phoneKey(mobile);
  if (!key || key.length !== 10) return null;
  try {
    const [p] = await query(
      `SELECT photo_url FROM reg_people
        WHERE ${last10Sql("mobile")} = ? AND NULLIF(TRIM(photo_url), '') IS NOT NULL
        ORDER BY id DESC LIMIT 1`,
      [key]
    );
    return p?.photo_url || null;
  } catch { return null; }
}

const trim = (v) => { const s = String(v ?? "").trim(); return s || null; };

// Resolve the best RETRIEVABLE photo for one contact row {id, phone_number,
// own_photo, worker_photo}. Order: own → linked worker → registration. Returns
// { url, indeterminate } where url is a verified-existing file (or null), and
// indeterminate=true means a storage lookup errored so existence is unknown.
async function bestRetrievablePhoto(row) {
  const candidates = [trim(row.own_photo), trim(row.worker_photo)].filter(Boolean);
  const reg = await regPhotoByMobile(row.phone_number);
  if (reg) candidates.push(trim(reg));
  let indeterminate = false;
  for (const url of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const { found, errored } = await checkUploadExists(url);
    if (found) return { url, indeterminate: false };
    if (errored) indeterminate = true;
  }
  return { url: null, indeterminate };
}

// Recover + verify a page of contacts. Idempotent and safe to re-run. `apply`
// false = report only (no writes). Returns tallies.
export async function recoverAndVerify({ apply = true, limit = 3000, offset = 0 } = {}) {
  await ensurePhotoVerifiedColumn();
  // Only rows that have SOME photo signal are worth checking (own ref, a linked
  // worker photo, or a registration photo by mobile) — everything else has no photo
  // to recover and is simply "no photo" (not counted, not shown).
  const rows = await query(
    `SELECT c.id, c.phone_number,
            NULLIF(TRIM(c.photo_url), '') AS own_photo,
            NULLIF(TRIM(w.photo_url), '') AS worker_photo
       FROM contacts c
       LEFT JOIN workers w ON w.id = c.worker_id
      WHERE NULLIF(TRIM(c.photo_url), '') IS NOT NULL
         OR NULLIF(TRIM(w.photo_url), '') IS NOT NULL
         OR EXISTS (SELECT 1 FROM reg_people rp
                     WHERE ${last10Sql("rp.mobile")} = ${last10Sql("c.phone_number")}
                       AND NULLIF(TRIM(rp.photo_url), '') IS NOT NULL)
      ORDER BY c.id ASC
      LIMIT ${Math.min(20000, Math.max(1, limit))} OFFSET ${Math.max(0, offset)}`
  );

  let checked = 0, valid = 0, recovered = 0, notAvailable = 0, indeterminate = 0;
  for (const row of rows) {
    checked += 1;
    // eslint-disable-next-line no-await-in-loop
    const { url, indeterminate: indet } = await bestRetrievablePhoto(row);
    if (indet && !url) { indeterminate += 1; continue; } // unknown → never touch
    if (url) {
      valid += 1;
      const own = trim(row.own_photo);
      const needsReconnect = own !== url; // own empty/dead → reconnect to the valid file
      if (needsReconnect) recovered += 1;
      if (apply) {
        // Reconnect the contact's OWN photo_url to the retrievable file (never
        // overwrites a valid own photo — own is only different when it was
        // empty/dead), and mark verified.
        // eslint-disable-next-line no-await-in-loop
        await query("UPDATE contacts SET photo_url = ?, photo_verified = 1 WHERE id = ?", [url, row.id]).catch(() => {});
      }
    } else {
      notAvailable += 1;
      // No retrievable photo anywhere — mark verified=0 but PRESERVE the reference
      // (never blank it, so a later-restored backup can still be reconnected).
      // eslint-disable-next-line no-await-in-loop
      if (apply) await query("UPDATE contacts SET photo_verified = 0 WHERE id = ?", [row.id]).catch(() => {});
    }
  }
  return { checked, valid, recovered, not_available: notAvailable, indeterminate, more: rows.length >= Math.min(20000, Math.max(1, limit)) };
}

// The Photo Data list: contacts that have (or had) a photo, newest first, with the
// resolved photo and its verified status. Search by name/mobile.
export async function photoDataPage({ page = 1, pageSize = 30, search = "", status = "" } = {}) {
  await ensurePhotoVerifiedColumn();
  const where = [
    `(NULLIF(TRIM(c.photo_url), '') IS NOT NULL OR NULLIF(TRIM(w.photo_url), '') IS NOT NULL)`,
  ];
  const params = [];
  const s = String(search || "").trim();
  if (s) { where.push(`(c.person_name LIKE ? OR c.phone_number LIKE ?)`); params.push(`%${s}%`, `%${s}%`); }
  if (status === "available") where.push(`c.photo_verified = 1`);
  else if (status === "unavailable") where.push(`c.photo_verified = 0`);
  else if (status === "unverified") where.push(`c.photo_verified IS NULL`);
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const ps = Math.min(100, Math.max(1, pageSize));
  const off = (Math.max(1, page) - 1) * ps;
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM contacts c LEFT JOIN workers w ON w.id = c.worker_id ${whereSql}`,
    params
  );
  const rows = await query(
    `SELECT c.id, c.person_name AS name, c.phone_number AS mobile,
            COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) AS photo_url,
            c.photo_verified
       FROM contacts c LEFT JOIN workers w ON w.id = c.worker_id
       ${whereSql}
      ORDER BY c.id DESC LIMIT ${ps} OFFSET ${off}`,
    params
  );
  return { rows, total, page: Math.max(1, page), pageSize: ps, pages: Math.max(1, Math.ceil(total / ps)) };
}

// Live summary for the Photo Data / Dashboard: total-with-reference, verified
// available, verified unavailable, and not-yet-verified.
export async function photoSummary() {
  await ensurePhotoVerifiedColumn();
  const [row] = await query(
    `SELECT
       SUM(CASE WHEN NULLIF(TRIM(c.photo_url), '') IS NOT NULL OR NULLIF(TRIM(w.photo_url), '') IS NOT NULL THEN 1 ELSE 0 END) AS with_reference,
       SUM(CASE WHEN c.photo_verified = 1 THEN 1 ELSE 0 END) AS available,
       SUM(CASE WHEN c.photo_verified = 0 THEN 1 ELSE 0 END) AS unavailable,
       SUM(CASE WHEN c.photo_verified IS NULL AND (NULLIF(TRIM(c.photo_url), '') IS NOT NULL OR NULLIF(TRIM(w.photo_url), '') IS NOT NULL) THEN 1 ELSE 0 END) AS unverified
     FROM contacts c LEFT JOIN workers w ON w.id = c.worker_id`
  );
  const num = (v) => Number(v) || 0;
  return {
    with_reference: num(row?.with_reference),
    available: num(row?.available),
    unavailable: num(row?.unavailable),
    unverified: num(row?.unverified),
  };
}
