import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isSupervisorRole, isCaller, isTopAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { pendingContactScope } from "@/lib/pendingContactScope";
import { query } from "@/lib/db";
import { phoneAlreadyRegistered } from "@/lib/contactDuplicate";
import { ensureContactApprovalColumns } from "@/lib/contactExtras";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// PUT /api/contacts/pending/[id]  { action: "approve" | "reject", reason? }
// A Supervisor (or oversight) reviews a caller-submitted contact. States:
//   pending  → awaiting review (not live anywhere)
//   approved → the SAME contact row goes live (Contact List + every contact feature)
//   rejected → kept as a reviewable record (submitter, reviewer, reason) but never
//              live; its mobile number is free to be registered again, and a later
//              submission for that number revives this row instead of duplicating it.
// Guards (server-side, never only the UI): the reviewer must hold the Worker
// Approval page; callers can never review; nobody but a top admin may approve or
// reject their OWN submission; the id must be inside the reviewer's territory.
export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !(await pageAllowed(session, "pending_contacts", isOversight(session) || isSupervisorRole(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    if (isCaller(session)) {
      return NextResponse.json({ message: "Callers cannot approve or reject contact submissions." }, { status: 403, headers: NO_STORE });
    }
    await ensureContactApprovalColumns();
    const { id } = await params;
    const d = await req.json().catch(() => ({}));
    const action = d?.action;

    const [row] = await query(
      "SELECT id, person_name, phone_number, approval_status, created_by_user_id FROM contacts WHERE id = ?",
      [id]
    );
    if (!row) return NextResponse.json({ message: "Contact not found." }, { status: 404, headers: NO_STORE });
    if (row.approval_status !== "pending" && row.approval_status !== "rejected") {
      return NextResponse.json({ message: "This contact is not awaiting approval." }, { status: 409, headers: NO_STORE });
    }
    if (row.created_by_user_id && Number(row.created_by_user_id) === Number(session.user.id) && !isTopAdmin(session)) {
      return NextResponse.json({ message: "You cannot approve or reject a contact you submitted yourself." }, { status: 403, headers: NO_STORE });
    }

    // Territory check (no IDOR): the same scope the queue list uses must also hold
    // for the id being acted on, so a reviewer can't approve/reject a contact
    // outside their own area.
    const scope = pendingContactScope(session, "c");
    if (scope.where) {
      // NOTE the space before the scope fragment: a Supervisor's fragment starts with
      // "AND ..." and, glued straight onto "c.id = ?", produced "?AND" — a SQL syntax
      // error that made EVERY in-scope Supervisor approve/reject return a 500
      // (admins were unaffected because their fragment is empty).
      const [inScope] = await query(`SELECT c.id FROM contacts c WHERE c.id = ? ${scope.where} LIMIT 1`, [id, ...scope.params]);
      if (!inScope) return NextResponse.json({ message: "This contact is outside your area." }, { status: 403, headers: NO_STORE });
    }

    if (action === "approve") {
      // A different live contact could have claimed this phone in the meantime —
      // re-check so approval never creates a duplicate live number.
      if (await phoneAlreadyRegistered(row.phone_number, id)) {
        return NextResponse.json({ message: "Another live contact already uses this mobile number." }, { status: 409, headers: NO_STORE });
      }
      // Conditional update: only a contact that is STILL pending/rejected may be
      // approved, so two simultaneous approvals (or a double click) cannot both
      // "succeed" — the loser updates 0 rows and is told it was already processed.
      const approved = await query(
        `UPDATE contacts SET approval_status = 'approved', reviewed_by_user_id = ?, reviewed_at = NOW(), rejection_reason = NULL
          WHERE id = ? AND approval_status IN ('pending','rejected')`,
        [session.user.id, id]
      );
      if (!approved.affectedRows) {
        return NextResponse.json({ message: "This contact was already processed by someone else. Refresh the list." }, { status: 409, headers: NO_STORE });
      }
      logAudit(session, { action: "contact.pending.approve", entityType: "contact", entityId: Number(id), details: { person_name: row.person_name, submitted_by_user_id: row.created_by_user_id || null, was: row.approval_status } });
      return NextResponse.json({ ok: true, status: "approved" }, { headers: NO_STORE });
    }
    if (action === "reject") {
      // A contact that is already rejected is not rejected again (that would only
      // overwrite the first reviewer's reason) — it is a conflicting update.
      if (row.approval_status === "rejected") {
        return NextResponse.json({ message: "This contact is already rejected." }, { status: 409, headers: NO_STORE });
      }
      const reason = String(d?.reason || "").trim().slice(0, 300) || null;
      const rejected = await query(
        `UPDATE contacts SET approval_status = 'rejected', reviewed_by_user_id = ?, reviewed_at = NOW(), rejection_reason = ?,
                             assigned_to_user_id = NULL, locked_by_user_id = NULL, locked_at = NULL
          WHERE id = ? AND approval_status = 'pending'`,
        [session.user.id, reason, id]
      );
      if (!rejected.affectedRows) {
        return NextResponse.json({ message: "This contact was already processed by someone else. Refresh the list." }, { status: 409, headers: NO_STORE });
      }
      logAudit(session, { action: "contact.pending.reject", entityType: "contact", entityId: Number(id), details: { person_name: row.person_name, phone_number: row.phone_number, submitted_by_user_id: row.created_by_user_id || null, reason } });
      return NextResponse.json({ ok: true, status: "rejected" }, { headers: NO_STORE });
    }
    return NextResponse.json({ message: "Invalid action." }, { status: 400, headers: NO_STORE });
  } catch (err) {
    console.error("[contacts] pending PUT:", err?.message || err);
    return NextResponse.json({ message: "Internal server error", detail: err?.sqlMessage || err?.message || null }, { status: 500, headers: NO_STORE });
  }
}
