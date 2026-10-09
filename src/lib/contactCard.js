import { query } from "@/lib/db";
import { DESIGNATION_IDS_SQL, DESIGNATION_NAMES_SQL } from "@/lib/contactDesignations";
import { WINGS_SQL, ensureContactWingsSchema } from "@/lib/contactWings";

// Resolve ONE contact into the exact shape the Contacts list renders — every
// derived display field (zone / lok sabha / district / assembly / block names,
// designation label, assigned-to username, resolved photo). Used by the update
// APIs so that after a Save the response carries the fresh, fully-resolved
// record — the client can drop its stale row data instead of keeping old names.
// This is the SINGLE source of truth every role reads, so Super Admin /
// Supervisor / Caller all see the identical updated data (no per-role copies).
export async function resolveContactCard(id) {
  await ensureContactWingsSchema();
  const rows = await query(
    `SELECT c.*,
            u.username AS assigned_to_username,
            ${WINGS_SQL} AS wings,
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

// Last-10-digit normalization of a phone column, matching resolveContactByPhone.
const PHONE10 = (col) =>
  `RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${col},' ',''),'-',''),'+',''),'(',''),')',''),'.',''), 10)`;

// BATCHED Joined-By resolver for the influencer LIST. Given a set of contact ids
// and/or last-10 phone keys, return each matched contact's display card in ONE
// query — keyed by id AND by phone10 — so a page of N influencers costs a couple
// of set-based lookups instead of N sequential per-row queries (which, under load
// on shared hosting, held DB connections long enough to stall the whole app).
// Same designation precedence as resolveContactCard (own designations → linked
// worker position → legacy single designation).
export async function resolveContactCardsBatch({ ids = [], phones10 = [] } = {}) {
  const idList = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const phoneList = [...new Set(phones10.filter(Boolean))];
  if (!idList.length && !phoneList.length) return { byId: new Map(), byPhone: new Map() };
  const conds = [];
  const params = [];
  if (idList.length) { conds.push(`c.id IN (${idList.map(() => "?").join(",")})`); params.push(...idList); }
  if (phoneList.length) { conds.push(`${PHONE10("c.phone_number")} IN (${phoneList.map(() => "?").join(",")})`); params.push(...phoneList); }
  const rows = await query(
    `SELECT c.id, c.person_name, c.phone_number, ${PHONE10("c.phone_number")} AS phone10,
            la.name AS assembly_name,
            COALESCE(${DESIGNATION_NAMES_SQL}, NULLIF(TRIM(w.position), ''), dsg.name) AS designation_name,
            COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) AS photo_url
       FROM contacts c
       LEFT JOIN workers w ON w.id = c.worker_id
       LEFT JOIN locations la ON la.id = c.assembly_id
       LEFT JOIN designations dsg ON dsg.id = c.designation_id
      WHERE ${conds.join(" OR ")}`,
    params
  );
  const byId = new Map();
  const byPhone = new Map();
  for (const r of rows) {
    byId.set(Number(r.id), r);
    if (r.phone10 && !byPhone.has(r.phone10)) byPhone.set(r.phone10, r); // lowest-id wins per phone
  }
  return { byId, byPhone };
}

// Workers matching any of the given last-10 phone keys, in ONE query (the
// Joined-By fallback for people who exist only as a Worker, not a Contact).
export async function resolveWorkersByPhones(phones10 = []) {
  const phoneList = [...new Set(phones10.filter(Boolean))];
  if (!phoneList.length) return new Map();
  const rows = await query(
    `SELECT name, mobile, photo_url, position, ${PHONE10("mobile")} AS phone10
       FROM workers WHERE ${PHONE10("mobile")} IN (${phoneList.map(() => "?").join(",")})`,
    phoneList
  );
  const m = new Map();
  for (const r of rows) if (r.phone10 && !m.has(r.phone10)) m.set(r.phone10, r);
  return m;
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
    designation_name: card.designation_name || null,
    assembly_id: card.assembly_id ?? null, assembly_name: card.assembly_name || null,
    district_id: card.district_id ?? null, district_name: card.district_name || null,
    lok_sabha_id: card.lok_sabha_id ?? null, lok_sabha_name: card.lok_sabha_name || null,
    zone_id: card.zone_id ?? null, zone_name: card.zone_name || null,
  };
}
