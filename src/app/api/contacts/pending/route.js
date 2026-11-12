import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isCaller, isOversight } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query, getPool } from "@/lib/db";
import { phoneKey, last10Sql } from "@/lib/phone";
import { ensureQualificationColumns, normalizeQualification } from "@/lib/contactQualification";
import { ensureVehicleColumn, normalizeVehicle } from "@/lib/contactVehicle";
import { phoneAlreadyRegistered, duplicatePhoneResponse } from "@/lib/contactDuplicate";
import { ensureContactDesignationsSchema, syncContactDesignations, parseDesignationIds } from "@/lib/contactDesignations";
import { syncContactWings } from "@/lib/contactWings";
import { prepareDesignationRows, applyRowWings } from "@/lib/contactDesignationRows";
import { ensureContactApprovalColumns, findRejectedContactByPhone } from "@/lib/contactExtras";
import { contactWriteError } from "@/lib/contactWriteError";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

async function contactCols() {
  const rows = await query(
    `SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts'`
  );
  return new Set(rows.map((r) => r.c));
}

// POST /api/contacts/pending — a CALLER (or oversight) adds a new contact from My Workspace. It goes STRAIGHT into the Contact List
// (approval_status = 'approved', no review step), recorded against the caller who added it. Same fields as the normal Add Contact form.
// Only this create action is open to callers; editing, deleting and assigning contacts keep their own permission checks. Duplicates are
// refused: the same number in any format (last 10 digits) is one person, and the check + insert run under a per-number database lock,
// so a double-click or two simultaneous submissions can never create two records. (The route name is kept for the existing callers.)
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !(isCaller(session) || isOversight(session))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const data = await req.json().catch(() => ({}));
    const { person_name, phone_number, address, designation_id, zone_id, lok_sabha_id, district_id, assembly_id, ward_id, booth_id, photo_url } = data;
    if (!person_name?.trim() || !phone_number?.trim()) {
      return NextResponse.json({ message: "Name and mobile number are required." }, { status: 400, headers: NO_STORE });
    }
    // Combined Designation + Wing rows (Add Contact): validated against Master Data and turned into the
    // designation set / wing set below; each designation is then saved paired with its Wing.
    const rowsRes = await prepareDesignationRows(data);
    if (rowsRes.error) return NextResponse.json({ message: rowsRes.error }, { status: 400 });
    const designationIds = parseDesignationIds(data.designation_ids ?? (designation_id ? [designation_id] : []));
    const primaryDesignation = designationIds[0] || null;

    const qual = normalizeQualification(data);
    if (qual.error) return NextResponse.json({ message: qual.error }, { status: 400, headers: NO_STORE });
    await ensureQualificationColumns();
    const veh = normalizeVehicle(data);
    if (veh.error) return NextResponse.json({ message: veh.error }, { status: 400, headers: NO_STORE });
    await ensureVehicleColumn();
    await ensureContactApprovalColumns(); // approval_status + created_by_user_id
    await ensureContactDesignationsSchema();
    const existing = await contactCols();
    const desired = {
      person_name: person_name.trim(),
      phone_number: phone_number.trim(),
      address: address || null,
      designation_id: primaryDesignation,
      // Geography falls back to the caller's OWN territory (session scope) when not supplied.
      zone_id: zone_id || session.user.scope_zone_id || null,
      lok_sabha_id: lok_sabha_id || session.user.scope_lok_sabha_id || null,
      district_id: district_id || session.user.home_district_id || null,
      assembly_id: assembly_id || session.user.scope_assembly_id || null,
      ward_id: ward_id || null,
      booth_id: booth_id || null,
      photo_url: photo_url || null,
      ...(qual.present ? { qualification: qual.qualification, education_level: qual.education_level } : {}),
      ...(veh.present ? { vehicle: veh.vehicle } : {}),
      // Live at once (no Supervisor approval); recorded against the caller who added it.
      approval_status: "approved",
      created_by_user_id: session.user.id || null,
      is_completed: 0,
    };
    const key = phoneKey(phone_number);
    const lockConn = await getPool().getConnection();
    const lockName = `contact-add:${key || phone_number.trim()}`.slice(0, 64);
    let id, revivedRejected = false;
    try {
      const [[lk]] = await lockConn.query("SELECT GET_LOCK(?, 10) AS ok", [lockName]);
      if (Number(lk.ok) !== 1) return NextResponse.json({ message: "Please try again in a moment." }, { status: 503, headers: NO_STORE });
      // Duplicate check INSIDE the lock: the exact number, or the same 10-digit number written another way.
      if (await phoneAlreadyRegistered(phone_number)) return duplicatePhoneResponse();
      if (key) {
        const notRejected = existing.has("approval_status") ? " AND (approval_status IS NULL OR approval_status <> 'rejected')" : "";
        const same = await query(`SELECT id FROM contacts WHERE ${last10Sql("phone_number")} = ?${notRejected} LIMIT 1`, [key]);
        if (same.length) return duplicatePhoneResponse();
      }
      const cols = [];
      const vals = [];
      for (const [k, v] of Object.entries(desired)) if (existing.has(k)) { cols.push(k); vals.push(v); }
      // A previously REJECTED submission for this number is revived in place (same
      // row, fresh data, now live) — never a second row for one number.
      const rejectedId = await findRejectedContactByPhone(desired.phone_number);
      if (rejectedId) {
        const resetCols = ["reviewed_by_user_id", "reviewed_at", "rejection_reason", "assigned_to_user_id", "locked_by_user_id", "locked_at"].filter((c) => existing.has(c));
        await query(
          `UPDATE contacts SET ${[...cols.map((c) => `${c} = ?`), ...resetCols.map((c) => `${c} = NULL`)].join(", ")} WHERE id = ?`,
          [...vals, rejectedId]
        );
        id = rejectedId;
      } else {
        const res = await query(
          `INSERT INTO contacts (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
          vals
        );
        id = res.insertId;
      }
      revivedRejected = !!rejectedId;
    } finally {
      await lockConn.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => {});
      lockConn.release();
    }
    await syncContactDesignations(id, designationIds);
    await syncContactWings(id, data.wings);
    await applyRowWings(id, rowsRes.rows);
    logAudit(session, { action: "contact.caller_create", entityType: "contact", entityId: id, details: { person_name: desired.person_name, phone_number: desired.phone_number, revived_rejected: revivedRejected } });
    return NextResponse.json({ id, status: "approved", revived: revivedRejected }, { status: 201, headers: NO_STORE });
  } catch (err) {
    return contactWriteError(err, "contacts pending POST");
  }
}

// GET /api/contacts/pending?mine=1 — the signed-in user's OWN submissions (any status: pending / approved / rejected, with the
// reviewer's decision), so a caller can follow what happened to what they added. Own rows only. (The Supervisor review queue that this
// endpoint also served was removed together with the Pending Approval page; without ?mine=1 the endpoint no longer exists.)
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const url = new URL(req.url);
    if (url.searchParams.get("mine") !== "1") return NextResponse.json({ message: "Not found" }, { status: 404, headers: NO_STORE });
    if (!(await ensureContactApprovalColumns())) {
      return NextResponse.json({ contacts: [] }, { headers: NO_STORE });
    }

    const where = " WHERE c.created_by_user_id = ? AND c.approval_status IN ('pending','approved','rejected')";
    const params = [session.user.id];

    const rows = await query(
      `SELECT c.id, c.person_name, c.phone_number, c.address, c.photo_url, c.approval_status,
              c.created_by_user_id, c.reviewed_by_user_id, c.reviewed_at, c.rejection_reason, c.created_at,
              (SELECT username FROM users u WHERE u.id = c.created_by_user_id) AS created_by_name,
              (SELECT username FROM users u WHERE u.id = c.reviewed_by_user_id) AS reviewed_by_name,
              dsg.name AS designation_name,
              (SELECT GROUP_CONCAT(dd.name ORDER BY dd.name SEPARATOR ', ')
                 FROM contact_designations cd JOIN designations dd ON dd.id = cd.designation_id
                WHERE cd.contact_id = c.id) AS designation_names,
              COALESCE(lz.name, dz.name) AS zone_name, COALESCE(lls.name, dls.name) AS lok_sabha_name,
              ld.name AS district_name, la.name AS assembly_name, lw.name AS block_name
         FROM contacts c
         LEFT JOIN designations dsg ON dsg.id = c.designation_id
         LEFT JOIN locations lz ON lz.id = c.zone_id
         LEFT JOIN locations lls ON lls.id = c.lok_sabha_id
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations dls ON dls.id = ld.parent_id AND dls.type = 'lok_sabha'
         LEFT JOIN locations dz ON dz.id = dls.parent_id
         LEFT JOIN locations la ON la.id = c.assembly_id
         LEFT JOIN locations lw ON lw.id = c.ward_id
        ${where}
        ORDER BY c.id DESC
        LIMIT 500`,
      params
    );
    return NextResponse.json({ contacts: rows }, { headers: NO_STORE });
  } catch (err) {
    console.error("[contacts] pending GET:", err?.message || err);
    return NextResponse.json({ message: "Internal server error", detail: err?.sqlMessage || err?.message || null }, { status: 500, headers: NO_STORE });
  }
}
