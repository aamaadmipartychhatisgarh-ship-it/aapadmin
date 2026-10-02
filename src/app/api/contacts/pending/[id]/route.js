import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isSupervisorRole } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { phoneAlreadyRegistered } from "@/lib/contactDuplicate";
import { ensureContactApprovalColumns } from "@/lib/contactExtras";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// PUT /api/contacts/pending/[id]  { action: "approve" | "reject", reason? }
// A Supervisor (or oversight) approves or rejects a caller-submitted contact.
//  - approve → approval_status = 'approved' → the SAME contact row goes live.
//  - reject  → approval_status = 'rejected' → stays out of every live list.
// The record id, name, phone, photo, designation, location and audit trail are all
// preserved; no duplicate contact is ever created.
export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !(await pageAllowed(session, "pending_contacts", isOversight(session) || isSupervisorRole(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    await ensureContactApprovalColumns();
    const { id } = await params;
    const d = await req.json().catch(() => ({}));
    const action = d?.action;

    const [row] = await query("SELECT id, person_name, phone_number, approval_status FROM contacts WHERE id = ?", [id]);
    if (!row) return NextResponse.json({ message: "Contact not found." }, { status: 404, headers: NO_STORE });
    if (row.approval_status !== "pending" && row.approval_status !== "rejected") {
      return NextResponse.json({ message: "This contact is not awaiting approval." }, { status: 409, headers: NO_STORE });
    }

    if (action === "approve") {
      // A different live contact could have claimed this phone in the meantime —
      // re-check so approval never creates a duplicate live number.
      if (await phoneAlreadyRegistered(row.phone_number, id)) {
        return NextResponse.json({ message: "Another live contact already uses this mobile number." }, { status: 409, headers: NO_STORE });
      }
      await query("UPDATE contacts SET approval_status = 'approved' WHERE id = ?", [id]);
      logAudit(session, { action: "contact.pending.approve", entityType: "contact", entityId: Number(id), details: { person_name: row.person_name } });
      return NextResponse.json({ ok: true, status: "approved" }, { headers: NO_STORE });
    }
    if (action === "reject") {
      await query("UPDATE contacts SET approval_status = 'rejected' WHERE id = ?", [id]);
      logAudit(session, { action: "contact.pending.reject", entityType: "contact", entityId: Number(id), details: { person_name: row.person_name, reason: String(d?.reason || "").slice(0, 300) || null } });
      return NextResponse.json({ ok: true, status: "rejected" }, { headers: NO_STORE });
    }
    return NextResponse.json({ message: "Invalid action." }, { status: 400, headers: NO_STORE });
  } catch (err) {
    console.error("[contacts] pending PUT:", err?.message || err);
    return NextResponse.json({ message: "Internal server error", detail: err?.sqlMessage || err?.message || null }, { status: 500, headers: NO_STORE });
  }
}
