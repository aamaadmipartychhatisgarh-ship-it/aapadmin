import { query, getPool } from "@/lib/db";
import { normalizeMobile } from "@/lib/registrationSchema";
import { last10Sql } from "@/lib/phone";
import { syncContactDesignations } from "@/lib/contactDesignations";
import { hasApprovalStatusColumn } from "@/lib/contactExtras";

// Worker & Voter Registration → Contact conversion.
//
// ELIGIBLE: a Worker registration (reg_people.person_type = 'worker') that is
// counted (status 'active' — not a duplicate / rejected entry) with a Karyakarta
// Rating (worker_rating, 1–10) of 6/10 or higher, not converted yet.
//
// The Contact is created in the EXISTING `contacts` table (same columns and rules
// as the Contacts module's own create: mandatory name + valid mobile, no duplicate
// mobile, full designation set). The link is permanent both ways:
//   contacts.source_registration_id  — UNIQUE: one Contact per Registration, ever
//   reg_people.converted_contact_id / converted_at / converted_by
// The Registration itself (and its history) is never deleted or altered otherwise.
export const MIN_CONVERT_RATING = 8;   // the top 3 ratings (8, 9, 10)

// AUTOMATIC conversion: a counted Worker whose Rank (reg_people.worker_rating, its numeric value) is 10 OR HIGHER is converted
// by the backend, with no button — on registration, on every edit / Rank change, and once for every existing record (backfill).
// Below 10 is never converted automatically (the manual button above still applies from 8).
export const AUTO_CONVERT_RANK = 10;
export function isAutoConvertEligible(p) {
  const r = Number(p?.worker_rating);
  return !!p && p.person_type === "worker" && p.status === "active" && Number.isFinite(r) && r >= AUTO_CONVERT_RANK;
}

export function isConvertEligible(p) {
  return !!p && p.person_type === "worker" && p.status === "active"
    && Number(p.worker_rating) >= MIN_CONVERT_RATING && !p.converted_contact_id;
}

let ensured = false;
export async function ensureConvertSchema() {
  if (ensured) return;
  const cols = async (t) => new Set((await query(
    "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [t]
  )).map((r) => r.c));
  const idx = async (t, name) => (await query(
    "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1", [t, name]
  )).length > 0;
  const c = await cols("contacts");
  if (!c.has("source_registration_id")) await query("ALTER TABLE contacts ADD COLUMN source_registration_id INT NULL");
  if (!(await idx("contacts", "uq_contacts_source_registration"))) {
    await query("ALTER TABLE contacts ADD UNIQUE KEY uq_contacts_source_registration (source_registration_id)");
  }
  const r = await cols("reg_people");
  for (const [k, def] of [["converted_contact_id", "INT NULL"], ["converted_at", "DATETIME NULL"], ["converted_by", "INT NULL"]]) {
    // eslint-disable-next-line no-await-in-loop
    if (!r.has(k)) await query(`ALTER TABLE reg_people ADD COLUMN \`${k}\` ${def}`);
  }
  if (!(await idx("reg_people", "uq_reg_people_converted_contact"))) {
    await query("ALTER TABLE reg_people ADD UNIQUE KEY uq_reg_people_converted_contact (converted_contact_id)");
  }
  // How it was converted ('auto' | 'manual') and when the linked Contact was last synchronised from the registration.
  const r2 = await cols("reg_people");
  if (!r2.has("convert_mode")) await query("ALTER TABLE reg_people ADD COLUMN convert_mode VARCHAR(10) NULL");
  if (!r2.has("contact_synced_at")) await query("ALTER TABLE reg_people ADD COLUMN contact_synced_at DATETIME NULL");
  // A clear record of every automatic attempt (created / linked / already / failed), incl. the backfill.
  await query(`CREATE TABLE IF NOT EXISTS reg_auto_convert_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    registration_id INT NOT NULL,
    outcome VARCHAR(12) NOT NULL,
    contact_id INT NULL,
    rank_value INT NULL,
    source VARCHAR(20) NULL,
    message VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_racl_reg (registration_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  ensured = true;
}

const fail = (status, message, extra = {}) => ({ status, message, ...extra });

// Convert one registration. Transaction + row lock on the registration, so
// repeated clicks / refreshes / concurrent requests serialize: the first one
// converts, every later one sees it already converted. The UNIQUE keys above are
// the final backstop. Returns { status, message, contact_id? }.
export async function convertRegistrationToContact({ registrationId, userId, mode = "manual" }) {
  await ensureConvertSchema();
  const id = Number(registrationId);
  if (!Number.isInteger(id) || id <= 0) return fail(400, "Invalid registration.");
  const conn = await getPool().getConnection();
  // Same-mobile serialisation: two DIFFERENT registrations of one number converting at the same moment would both see "no
  // Contact with this number" and both insert one. A per-number database lock makes the second wait and then LINK the first's
  // Contact. (The same registration is already serialised by its row lock below + the UNIQUE keys.)
  let mobileLock = null;
  try {
    const [[pre]] = await conn.query("SELECT mobile FROM reg_people WHERE id = ?", [id]);
    const m10 = String(pre?.mobile || "").replace(/\D/g, "").slice(-10);
    if (m10.length === 10) {
      const [[lk]] = await conn.query("SELECT GET_LOCK(?, 15) AS ok", [`regconv:${m10}`]);
      if (Number(lk?.ok) === 1) mobileLock = `regconv:${m10}`;
      else { conn.release(); return fail(503, "Another conversion for this number is in progress. Please try again."); }
    }
  } catch (e) { conn.release(); throw e; }
  try {
    await conn.beginTransaction();
    const [[p]] = await conn.query(
      `SELECT p.*, w.name AS worker_name FROM reg_people p LEFT JOIN reg_workers w ON w.id = p.worker_id
        WHERE p.id = ? FOR UPDATE`, [id]
    );
    if (!p) { await conn.rollback(); return fail(404, "Registration not found."); }
    if (p.converted_contact_id) {
      await conn.rollback();
      return fail(409, "This worker has already been converted to a Contact.", { contact_id: p.converted_contact_id });
    }
    if (mode === "auto" ? !isAutoConvertEligible(p) : !isConvertEligible(p)) {
      await conn.rollback();
      return fail(400, p.person_type !== "worker" ? "Only Worker registrations can be converted to a Contact."
        : p.status !== "active" ? "Only counted registrations (not duplicate / rejected) can be converted."
        : `Only Workers rated ${MIN_CONVERT_RATING}/10 or higher can be converted (this worker is rated ${p.worker_rating ?? "—"}/10).`);
    }
    // Mandatory Contact fields: name + a valid mobile. Never create an incomplete Contact.
    const name = String(p.name || "").trim();
    const mobile = normalizeMobile(p.mobile);
    const missing = [!name && "name", !mobile && "a valid 10-digit mobile number"].filter(Boolean);
    if (missing.length) {
      await conn.rollback();
      return fail(400, `Cannot convert: the registration is missing ${missing.join(" and ")}. Edit the registration first.`);
    }
    // No duplicate Contact: any live contact with the same number (any format).
    const notRejected = (await hasApprovalStatusColumn()) ? " AND (approval_status IS NULL OR approval_status <> 'rejected')" : "";
    // The Contact this registration is ALREADY linked to (matched by number when it was registered) is reused first; then any
    // live Contact with the same number. Never matched by name.
    let [dups] = p.contact_id
      ? await conn.query(`SELECT id, person_name FROM contacts WHERE id = ? AND ${last10Sql("phone_number")} = ?${notRejected} LIMIT 1`, [p.contact_id, mobile])
      : [[]];
    if (!dups.length) [dups] = await conn.query(
      `SELECT id, person_name FROM contacts WHERE ${last10Sql("phone_number")} = ?${notRejected} ORDER BY id LIMIT 1`, [mobile]
    );
    if (dups.length) {
      // The person already IS a Contact: LINK this registration to it - no second contact is created and the
      // Contact's own data is left exactly as it is (only its empty registration back-link is filled).
      const existingId = dups[0].id;
      const [[taken]] = await conn.query("SELECT id FROM reg_people WHERE converted_contact_id = ? AND id <> ? LIMIT 1", [existingId, p.id]);
      if (taken) {
        await conn.rollback();
        return fail(409, `A contact with this mobile number already exists (${dups[0].person_name || "Contact"} #${existingId}) and is already linked to another registration. It was not converted again.`, { existing_contact_id: existingId });
      }
      await conn.query("UPDATE reg_people SET converted_contact_id = ?, contact_id = ?, converted_at = NOW(), converted_by = ?, convert_mode = ?, contact_synced_at = NOW() WHERE id = ? AND converted_contact_id IS NULL", [existingId, existingId, userId || null, mode, p.id]);
      await conn.query("UPDATE contacts SET source_registration_id = ? WHERE id = ? AND source_registration_id IS NULL", [p.id, existingId]);
      await conn.commit();
      return { status: 200, message: `Linked to the existing contact ${dups[0].person_name || ""} (#${existingId}) — no new contact was created.`, contact_id: existingId, linked_existing: true };
    }
    // Location: the registration's Assembly (+ its District / Lok Sabha / Zone
    // above it) and Block (stored on contacts as ward_id, the Block level).
    let geo = { district_id: null, lok_sabha_id: null, zone_id: null };
    if (p.assembly_id) {
      const [[g]] = await conn.query(
        `SELECT ld.id AS district_id, lls.id AS lok_sabha_id, lz.id AS zone_id
           FROM locations la
           LEFT JOIN locations ld ON ld.id = la.parent_id AND ld.type = 'district'
           LEFT JOIN locations lls ON lls.id = ld.parent_id AND lls.type = 'lok_sabha'
           LEFT JOIN locations lz ON lz.id = lls.parent_id AND lz.type = 'zone'
          WHERE la.id = ? AND la.type = 'assembly'`, [p.assembly_id]
      );
      if (g) geo = g;
    }
    // Details the Contact has no dedicated column for are kept in remarks.
    const remarks = [
      `Converted from Registration #${p.id}`,
      p.worker_rating != null ? `Rank ${p.worker_rating}` : null,
      p.worker_role ? `Worker role: ${p.worker_role}` : null,
      p.ward_name || p.ward_number ? `Ward: ${p.ward_name || p.ward_number}` : null,
      p.area_booth ? `Area / Booth: ${p.area_booth}` : null,
      p.worker_name ? `Registered by: ${p.worker_name}` : null,
    ].filter(Boolean).join(" · ");
    const [colRows] = await conn.query(
      "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts'"
    );
    const have = new Set(colRows.map((r) => r.c));
    const photo = p.photo_url && String(p.photo_url).length <= 255 ? p.photo_url : null;
    const desired = {
      person_name: name, phone_number: mobile, address: p.address || null,
      assembly_id: p.assembly_id || null, district_id: geo.district_id || null,
      lok_sabha_id: geo.lok_sabha_id || null, zone_id: geo.zone_id || null,
      ward_id: p.block_id || null, designation_id: p.designation_id || null,
      photo_url: photo, remarks, created_by_user_id: userId || null,
      source_registration_id: p.id,
    };
    const cols = Object.keys(desired).filter((k) => have.has(k));
    const [ins] = await conn.query(
      `INSERT INTO contacts (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      cols.map((k) => desired[k])
    );
    const contactId = ins.insertId;
    await conn.query(
      "UPDATE reg_people SET converted_contact_id = ?, contact_id = ?, converted_at = NOW(), converted_by = ?, convert_mode = ?, contact_synced_at = NOW() WHERE id = ? AND converted_contact_id IS NULL",
      [contactId, contactId, userId || null, mode, p.id]
    );
    await conn.commit();
    // The designation set (contact_designations) — same as the Contacts create path.
    if (p.designation_id) await syncContactDesignations(contactId, [p.designation_id]).catch(() => {});
    return { status: 201, message: `${name} converted to a Contact.`, contact_id: contactId };
  } catch (e) {
    await conn.rollback().catch(() => {});
    if (e?.code === "ER_DUP_ENTRY") {
      // A concurrent request won the race (or the mobile was just added) — never a second row.
      const [row] = await query("SELECT converted_contact_id FROM reg_people WHERE id = ?", [id]);
      if (row?.converted_contact_id) return fail(409, "This worker has already been converted to a Contact.", { contact_id: row.converted_contact_id });
      return fail(409, "A contact with this mobile number already exists. It was not converted again.");
    }
    throw e;
  } finally {
    if (mobileLock) await conn.query("SELECT RELEASE_LOCK(?)", [mobileLock]).catch(() => {});
    conn.release();
  }
}


// ------------------------------------------------------------------------------------------------ AUTOMATIC CONVERSION
async function logAuto(registrationId, outcome, { contactId = null, rank = null, source = null, message = null } = {}) {
  await query("INSERT INTO reg_auto_convert_log (registration_id, outcome, contact_id, rank_value, source, message) VALUES (?, ?, ?, ?, ?, ?)",
    [registrationId, outcome, contactId, rank, source, message ? String(message).slice(0, 500) : null]).catch(() => {});
}

// Convert ONE registration automatically if it is eligible (Rank >= 10, counted Worker) and not linked yet. Idempotent: an
// already-converted registration is left alone (never a second Contact) — every repeat / retry / simultaneous call ends in the
// same single link (row lock + per-number lock + UNIQUE keys inside convertRegistrationToContact). Never throws.
// Returns { outcome: "created" | "linked" | "already" | "not_eligible" | "failed", contact_id?, message? }.
export async function autoConvertRegistration(registrationId, { userId = null, source = "auto" } = {}) {
  try {
    await ensureConvertSchema();
    const [p] = await query("SELECT id, person_type, status, worker_rating, converted_contact_id FROM reg_people WHERE id = ?", [registrationId]);
    if (!p) return { outcome: "failed", message: "Registration not found." };
    if (p.converted_contact_id) return { outcome: "already", contact_id: p.converted_contact_id };
    if (!isAutoConvertEligible(p)) return { outcome: "not_eligible" };
    const r = await convertRegistrationToContact({ registrationId: p.id, userId, mode: "auto" });
    let outcome;
    if (r.status === 201) outcome = "created";
    else if (r.status === 200) outcome = "linked";
    else if (r.status === 409 && r.contact_id) outcome = "already";        // a parallel request converted it a moment earlier
    else outcome = "failed";
    await logAuto(p.id, outcome, { contactId: r.contact_id || null, rank: Number(p.worker_rating), source, message: r.message });
    return { outcome, contact_id: r.contact_id || null, message: r.message };
  } catch (e) {
    await logAuto(Number(registrationId), "failed", { source, message: e?.message || String(e) });
    return { outcome: "failed", message: e?.message || "Error" };
  }
}

// After a registration is EDITED: keep its linked Contact in step using SAFE PARTIAL updates — only the fields that actually
// changed in this edit, and only to a non-blank value (a blank never erases Contact data; untouched fields are never rewritten,
// so edits made on the Contact itself survive). The mobile is moved only when no other Contact holds the new number.
const SYNC_MAP = { name: "person_name", address: "address", photo_url: "photo_url", block_id: "ward_id" };
export async function syncLinkedContact(registrationId, before) {
  try {
    await ensureConvertSchema();
    const [p] = await query("SELECT * FROM reg_people WHERE id = ?", [registrationId]);
    if (!p?.converted_contact_id || !before) return;
    const cid = p.converted_contact_id;
    const have = new Set((await query("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts'")).map((r) => r.c));
    const changed = (k) => String(before[k] ?? "") !== String(p[k] ?? "") && String(p[k] ?? "").trim() !== "";
    const sets = [], vals = [];
    for (const [k, col] of Object.entries(SYNC_MAP)) if (have.has(col) && changed(k)) { sets.push(`${col} = ?`); vals.push(p[k]); }
    if (changed("assembly_id") && have.has("assembly_id")) {
      const [g] = await query(
        `SELECT ld.id AS district_id, lls.id AS lok_sabha_id, lz.id AS zone_id FROM locations la
           LEFT JOIN locations ld ON ld.id = la.parent_id AND ld.type = 'district'
           LEFT JOIN locations lls ON lls.id = ld.parent_id AND lls.type = 'lok_sabha'
           LEFT JOIN locations lz ON lz.id = lls.parent_id AND lz.type = 'zone'
          WHERE la.id = ? AND la.type = 'assembly'`, [p.assembly_id]);
      sets.push("assembly_id = ?"); vals.push(p.assembly_id);
      for (const k of ["district_id", "lok_sabha_id", "zone_id"]) if (g?.[k] && have.has(k)) { sets.push(`${k} = ?`); vals.push(g[k]); }
    }
    if (changed("mobile")) {
      const m = normalizeMobile(p.mobile);
      const [other] = m ? await query(`SELECT id FROM contacts WHERE ${last10Sql("phone_number")} = ? AND id <> ? LIMIT 1`, [m, cid]) : [null];
      if (m && !other) { sets.push("phone_number = ?"); vals.push(m); }
    }
    if (sets.length) await query(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`, [...vals, cid]);
    await query("UPDATE reg_people SET contact_synced_at = NOW() WHERE id = ?", [p.id]);
  } catch (e) {
    console.error("[registration] syncLinkedContact:", e?.message || e);
  }
}

// One call for every write path (new registration, own edit, admin edit, status change): link-sync if already converted,
// else convert if now eligible (e.g. Rank raised from 9 to 10). Never throws, never blocks the save that triggered it.
export async function afterRegistrationSaved(registrationId, { before = null, userId = null, source = "auto" } = {}) {
  if (before) await syncLinkedContact(registrationId, before);
  return autoConvertRegistration(registrationId, { userId, source });
}

// ONE-TIME BACKFILL for workers registered before automatic conversion existed: every counted Worker with Rank >= 10 that has
// no linked Contact yet is converted (or linked to the Contact that already holds the number). Safe to interrupt and resume:
// it only ever picks still-unlinked registrations, in id order, and the ledger is written only when a full pass has finished.
// Every attempt is recorded in reg_auto_convert_log. Runs once per deployment (ledger) and once per process at most.
let backfillRun = null;
export function runAutoConvertBackfill() {
  if (!backfillRun) backfillRun = (async () => {
    await ensureConvertSchema();
    await query(`CREATE TABLE IF NOT EXISTS app_migrations (name VARCHAR(128) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    if ((await query("SELECT 1 FROM app_migrations WHERE name = 'reg_auto_convert_backfill_v1' LIMIT 1")).length) return { skipped: true };
    const summary = { eligible: 0, created: 0, linked: 0, already: 0, failed: 0 };
    const rows = await query(
      `SELECT id FROM reg_people WHERE person_type = 'worker' AND status = 'active' AND worker_rating >= ? ORDER BY id`, [AUTO_CONVERT_RANK]);
    summary.eligible = rows.length;
    for (const r of rows) {
      // eslint-disable-next-line no-await-in-loop
      const out = await autoConvertRegistration(r.id, { source: "backfill" });
      if (summary[out.outcome] != null) summary[out.outcome] += 1;
    }
    await query("INSERT IGNORE INTO app_migrations (name) VALUES ('reg_auto_convert_backfill_v1')");
    console.log("[registration] auto-convert backfill:", JSON.stringify(summary));
    return summary;
  })().catch((e) => { backfillRun = null; console.error("[registration] auto-convert backfill:", e?.message || e); return { error: e?.message }; });
  return backfillRun;
}
