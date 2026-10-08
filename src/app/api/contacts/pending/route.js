import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isCaller, isOversight, isSupervisorRole } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { pendingContactScope } from "@/lib/pendingContactScope";
import { query } from "@/lib/db";
import { phoneAlreadyRegistered, duplicatePhoneResponse } from "@/lib/contactDuplicate";
import { ensureContactDesignationsSchema, syncContactDesignations, parseDesignationIds } from "@/lib/contactDesignations";
import { syncContactWings } from "@/lib/contactWings";
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
    // A previously REJECTED submission for this number is revived in place (same
    // row, fresh data, back to pending) — never a second row for one number.
    const rejectedId = await findRejectedContactByPhone(desired.phone_number);
    let id;
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
    await syncContactDesignations(id, designationIds);
    await syncContactWings(id, data.wings);
    logAudit(session, { action: "contact.pending.create", entityType: "contact", entityId: id, details: { person_name: desired.person_name, phone_number: desired.phone_number, revived_rejected: !!rejectedId } });
    return NextResponse.json({ id, status: "pending", revived: !!rejectedId }, { status: 201, headers: NO_STORE });
  } catch (err) {
    return contactWriteError(err, "contacts pending POST");
  }
}

// GET /api/contacts/pending — two uses:
//   • ?mine=1 — the signed-in user's OWN submissions (any status: pending /
//     approved / rejected, with the reviewer's decision), so a caller can follow
//     what happened to what they added. Any signed-in user, own rows only.
//   • otherwise — the Supervisor/oversight review queue (?status=pending|rejected),
//     scoped to the viewer's territory.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const url = new URL(req.url);
    const mine = url.searchParams.get("mine") === "1";
    if (!mine && !(await pageAllowed(session, "pending_contacts", isOversight(session) || isSupervisorRole(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    if (!(await ensureContactApprovalColumns())) {
      return NextResponse.json({ contacts: [] }, { headers: NO_STORE });
    }

    let where;
    const params = [];
    if (mine) {
      where = " WHERE c.created_by_user_id = ? AND c.approval_status IN ('pending','approved','rejected')";
      params.push(session.user.id);
    } else {
      const statusF = ["pending", "rejected"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "pending";
      where = " WHERE c.approval_status = ?";
      params.push(statusF);
      // Territory scope — a Supervisor/sub-admin/portal member sees only pending
      // contacts in their own area; super/state admins see all (shared helper, so the
      // list and the approve/reject mutation enforce exactly the same boundary).
      const scope = pendingContactScope(session, "c");
      if (scope.where) { where += " " + scope.where; params.push(...scope.params); }
    }

    const rows = await query(
      `SELECT c.id, c.person_name, c.phone_number, c.address, c.photo_url, c.approval_status,
              c.created_by_user_id, c.reviewed_by_user_id, c.reviewed_at, c.rejection_reason, c.created_at,
              (SELECT username FROM users u WHERE u.id = c.created_by_user_id) AS created_by_name,
              (SELECT username FROM users u WHERE u.id = c.reviewed_by_user_id) AS reviewed_by_name,
              dsg.name AS designation_name,
              (SELECT GROUP_CONCAT(dd.name ORDER BY dd.name SEPARATOR ', ')
                 FROM contact_designations cd JOIN designations dd ON dd.id = cd.designation_id
                WHERE cd.contact_id = c.id) AS designation_names,
              lz.name AS zone_name, lls.name AS lok_sabha_name,
              ld.name AS district_name, la.name AS assembly_name, lw.name AS block_name
         FROM contacts c
         LEFT JOIN designations dsg ON dsg.id = c.designation_id
         LEFT JOIN locations lz ON lz.id = c.zone_id
         LEFT JOIN locations lls ON lls.id = c.lok_sabha_id
         LEFT JOIN locations ld ON ld.id = c.district_id
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
