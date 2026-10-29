import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSuperAdmin, normalizeRole, ROLES } from "@/lib/permissions";
import { query } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { notPendingClause, hasContactRemarksColumn } from "@/lib/contactExtras";
import { supervisorScopeFilter } from "@/lib/supervisorScope";
import { ensureRfaSchema, RFA_STATUSES } from "@/lib/rfa";
import { ensureQualificationColumns } from "@/lib/contactQualification";
import { ensureVehicleColumn } from "@/lib/contactVehicle";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// GET /api/rfa?status=Pending|Correct|Incorrect — the Super Admin's RfA Review
// List (every submission, newest first) + per-status counts.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (!isSuperAdmin(session)) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    await ensureRfaSchema();
    // Qualification / Vehicle are lazily-added Contact columns — make sure they exist.
    await ensureQualificationColumns().catch(() => {});
    await ensureVehicleColumn().catch(() => {});
    const status = new URL(req.url).searchParams.get("status") || "";
    const where = RFA_STATUSES.includes(status) ? "WHERE r.status = ?" : "";
    const rows = await query(
      // Everything about the Contact is read LIVE from the linked contacts row (never
      // copied onto the review), with the same geography derivation as the Contact
      // List: district → Lok Sabha, the contact's own Lok Sabha winning. Remarks = the contact's saved Remarks / Notes (Add Contact).
      `SELECT r.*, c.person_name, c.phone_number, c.address, c.photo_url,
              c.qualification, c.education_level, c.vehicle, ${(await hasContactRemarksColumn()) ? "c.remarks" : "NULL"} AS contact_remarks,
              la.name AS assembly_name, ld.name AS district_name,
              COALESCE(cls.name, lls.name) AS lok_sabha_name,
              (SELECT d.name FROM designations d WHERE d.id = c.designation_id) AS designation_name
         FROM contact_rfa_reviews r
         LEFT JOIN contacts c ON c.id = r.contact_id
         LEFT JOIN locations la ON la.id = c.assembly_id
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations lls ON lls.id = ld.parent_id
         LEFT JOIN locations cls ON cls.id = c.lok_sabha_id
         ${where}
        ORDER BY r.id DESC LIMIT 1000`,
      where ? [status] : []
    );
    const counts = await query("SELECT status, COUNT(*) AS n FROM contact_rfa_reviews GROUP BY status");
    const byStatus = { Pending: 0, Correct: 0, Incorrect: 0 };
    for (const c of counts) byStatus[c.status] = Number(c.n) || 0;
    return NextResponse.json({ reviews: rows, counts: byStatus }, { headers: NO_STORE });
  } catch (err) {
    console.error("[rfa] list:", err?.sqlMessage || err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

// POST /api/rfa { contact_id } — a Supervisor-2 submits a Contact for review.
// Backend rules (the UI button is only a convenience):
//   • role must be supervisor (anyone else → 403)
//   • the Contact must be live and inside the supervisor's own territory
//   • at most ONE active (Pending/Correct) review per Contact — enforced by the
//     UNIQUE active_contact_id key, so concurrent / repeated requests create one row
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (normalizeRole(session.user?.role) !== ROLES.SUPERVISOR) return NextResponse.json({ message: "Only a Supervisor-2 can submit a contact for RfA." }, { status: 403, headers: NO_STORE });
    const body = await req.json().catch(() => ({}));
    const contactId = parseInt(body?.contact_id, 10);
    if (!Number.isInteger(contactId) || contactId <= 0) return NextResponse.json({ message: "Invalid contact." }, { status: 400, headers: NO_STORE });
    await ensureRfaSchema();

    const scope = supervisorScopeFilter(session.user, "c");
    const notPending = await notPendingClause("c");
    const [contact] = await query(
      `SELECT c.id, c.person_name, c.phone_number FROM contacts c WHERE c.id = ? ${notPending} ${scope.where}`,
      [contactId, ...scope.params]
    );
    if (!contact) return NextResponse.json({ message: "Contact not found in your area." }, { status: 404, headers: NO_STORE });
    if (!String(contact.person_name || "").trim() || !String(contact.phone_number || "").trim()) {
      return NextResponse.json({ message: "The contact needs a name and phone number before it can be submitted." }, { status: 400, headers: NO_STORE });
    }
    try {
      const res = await query(
        `INSERT INTO contact_rfa_reviews (contact_id, submitted_by_user_id, submitted_by_name, status, active_contact_id)
         VALUES (?, ?, ?, 'Pending', ?)`,
        [contactId, session.user.id, String(session.user.name || session.user.username || "").slice(0, 150) || null, contactId]
      );
      logAudit(session, { action: "rfa_submit", entityType: "contact", entityId: String(contactId), details: `RfA review #${res.insertId} submitted for ${contact.person_name}` });
      return NextResponse.json({ review: { id: res.insertId, contact_id: contactId, status: "Pending" } }, { status: 201, headers: NO_STORE });
    } catch (e) {
      if (e?.code === "ER_DUP_ENTRY") {
        const [cur] = await query("SELECT status FROM contact_rfa_reviews WHERE active_contact_id = ?", [contactId]);
        return NextResponse.json({ message: `This contact already has an RfA review (${cur?.status || "active"}).`, status: cur?.status || null }, { status: 409, headers: NO_STORE });
      }
      throw e;
    }
  } catch (err) {
    console.error("[rfa] submit:", err?.sqlMessage || err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
