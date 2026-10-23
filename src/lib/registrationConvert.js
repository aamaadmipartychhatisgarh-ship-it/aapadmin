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
export const MIN_CONVERT_RATING = 6;

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
  ensured = true;
}

const fail = (status, message, extra = {}) => ({ status, message, ...extra });

// Convert one registration. Transaction + row lock on the registration, so
// repeated clicks / refreshes / concurrent requests serialize: the first one
// converts, every later one sees it already converted. The UNIQUE keys above are
// the final backstop. Returns { status, message, contact_id? }.
export async function convertRegistrationToContact({ registrationId, userId }) {
  await ensureConvertSchema();
  const id = Number(registrationId);
  if (!Number.isInteger(id) || id <= 0) return fail(400, "Invalid registration.");
  const conn = await getPool().getConnection();
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
    if (!isConvertEligible(p)) {
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
    const [dups] = await conn.query(
      `SELECT id, person_name FROM contacts WHERE ${last10Sql("phone_number")} = ?${notRejected} LIMIT 1`, [mobile]
    );
    if (dups.length) {
      await conn.rollback();
      return fail(409, `A contact with this mobile number already exists (${dups[0].person_name || "Contact"} #${dups[0].id}). It was not converted again.`, { existing_contact_id: dups[0].id });
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
      p.worker_rating != null ? `Karyakarta Rating ${p.worker_rating}/10` : null,
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
      "UPDATE reg_people SET converted_contact_id = ?, converted_at = NOW(), converted_by = ? WHERE id = ? AND converted_contact_id IS NULL",
      [contactId, userId || null, p.id]
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
    conn.release();
  }
}
