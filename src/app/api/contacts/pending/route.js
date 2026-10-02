import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isCaller, isOversight, isSupervisorRole, scopeFilterSync } from "@/lib/permissions";
import { query } from "@/lib/db";
import { phoneAlreadyRegistered, duplicatePhoneResponse } from "@/lib/contactDuplicate";
import { ensureContactDesignationsSchema, syncContactDesignations, parseDesignationIds } from "@/lib/contactDesignations";
import { ensureContactApprovalColumns } from "@/lib/contactExtras";
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

// POST /api/contacts/pending — a CALLER (or oversight) submits a new contact that
// does NOT go live: it is stored with approval_status = 'pending' and surfaces only
// in the Supervisor "Pending Approval" queue until approved. Same fields as the
// normal Add Contact form; duplicate-phone is still rejected up front.
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
    const designationIds = parseDesignationIds(data.designation_ids ?? (designation_id ? [designation_id] : []));
    const primaryDesignation = designationIds[0] || null;
    if (await phoneAlreadyRegistered(phone_number)) return duplicatePhoneResponse();

    await ensureContactApprovalColumns(); // approval_status + created_by_user_id
    await ensureContactDesignationsSchema();
    const existing = await contactCols();
    const desired = {
      person_name: person_name.trim(),
      phone_number: phone_number.trim(),
      address: address || null,
      designation_id: primaryDesignation,
      // Geography falls back to the caller's OWN territory (session scope) when not
      // supplied, so the pending contact lands in the right Supervisor's queue.
      zone_id: zone_id || session.user.scope_zone_id || null,
      lok_sabha_id: lok_sabha_id || session.user.scope_lok_sabha_id || null,
      district_id: district_id || session.user.home_district_id || null,
      assembly_id: assembly_id || session.user.scope_assembly_id || null,
      ward_id: ward_id || null,
      booth_id: booth_id || null,
      photo_url: photo_url || null,
      // Pending until a Supervisor approves; recorded against the caller who added it.
      approval_status: "pending",
      created_by_user_id: session.user.id || null,
      is_completed: 0,
    };
    const cols = [];
    const vals = [];
    for (const [k, v] of Object.entries(desired)) if (existing.has(k)) { cols.push(k); vals.push(v); }
    const res = await query(
      `INSERT INTO contacts (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      vals
    );
    await syncContactDesignations(res.insertId, designationIds);
    logAudit(session, { action: "contact.pending.create", entityType: "contact", entityId: res.insertId, details: { person_name: desired.person_name, phone_number: desired.phone_number } });
    return NextResponse.json({ id: res.insertId, status: "pending" }, { status: 201, headers: NO_STORE });
  } catch (err) {
    return contactWriteError(err, "contacts pending POST");
  }
}

// GET /api/contacts/pending — the Supervisor/oversight review queue: contacts a
// caller submitted that are awaiting approval, scoped to the viewer's territory.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !(isOversight(session) || isSupervisorRole(session))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    if (!(await ensureContactApprovalColumns())) {
      return NextResponse.json({ contacts: [] }, { headers: NO_STORE });
    }
    const url = new URL(req.url);
    const statusF = ["pending", "rejected"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "pending";

    let where = " WHERE c.approval_status = ?";
    const params = [statusF];
    // Territory scope: a supervisor sees only pending contacts in their area; super/
    // state admins see all. scopeFilterSync is the same non-bypassable geo scope the
    // rest of the app uses.
    if (!isOversight(session) || isSupervisorRole(session)) {
      const scope = scopeFilterSync(session.user, "c");
      if (scope.where) { where += " " + scope.where; params.push(...scope.params); }
    }

    const rows = await query(
      `SELECT c.id, c.person_name, c.phone_number, c.address, c.photo_url, c.approval_status,
              c.created_by_user_id,
              (SELECT username FROM users u WHERE u.id = c.created_by_user_id) AS created_by_name,
              dsg.name AS designation_name,
              ld.name AS district_name, la.name AS assembly_name
         FROM contacts c
         LEFT JOIN designations dsg ON dsg.id = c.designation_id
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations la ON la.id = c.assembly_id
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
