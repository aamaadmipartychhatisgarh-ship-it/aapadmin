import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { usersForDesignation, notifyUsers } from "@/lib/numberCorrections";

async function loadRequest(id) {
  const [row] = await query(
    `SELECT r.*, c.person_name, c.phone_number AS current_phone_number, c.district_id
       FROM number_correction_requests r JOIN contacts c ON c.id = r.contact_id
      WHERE r.id = ?`,
    [id]
  );
  return row;
}

// Is `userId` currently allowed to act on this request as the designation
// holder (correct/reject)? True once verified (target_designation_id set)
// AND the user actually holds that designation via a linked worker account.
async function isAssignedRecipient(reqRow, userId) {
  if (!reqRow.target_designation_id) return false;
  const recipients = await usersForDesignation(reqRow.target_designation_id);
  return recipients.some((u) => u.id === userId);
}

// GET /api/number-corrections/:id — single request. Open to oversight, or to
// the user it was assigned to (so the recipient action page can load it
// without needing admin rights).
export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const reqRow = await loadRequest(id);
    if (!reqRow) return NextResponse.json({ message: "Not found" }, { status: 404 });
    if (!isOversight(session) && !(await isAssignedRecipient(reqRow, session.user.id))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ request: reqRow });
  } catch (err) {
    console.error("number-corrections/[id] GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/number-corrections/:id  { action: 'verify'|'reject'|'correct'|'resolve', ...fields }
export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const reqRow = await loadRequest(id);
    if (!reqRow) return NextResponse.json({ message: "Not found" }, { status: 404 });

    const oversight = isOversight(session);

    if (body.action === "verify") {
      // Step 2: "Supervisor verifies" — routes the request to a Designation.
      if (!oversight) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
      if (reqRow.status !== "pending" || reqRow.target_designation_id) {
        return NextResponse.json({ message: "Already verified or no longer pending" }, { status: 409 });
      }
      const designationId = Number(body.designation_id);
      if (!designationId) return NextResponse.json({ message: "designation_id is required" }, { status: 400 });
      const recipients = await usersForDesignation(designationId);

      await query(
        `UPDATE number_correction_requests SET target_designation_id = ?, verified_by_user_id = ?, verified_at = NOW() WHERE id = ?`,
        [designationId, session.user.id, id]
      );
      logAudit(session, { action: "number_correction.verify", entityType: "number_correction_request", entityId: id, details: { designation_id: designationId, recipients: recipients.length } });
      notifyUsers(recipients.map((u) => u.id), {
        type: "number_correction_assigned",
        title: `Number correction needed: ${reqRow.person_name}`,
        body: `Reported ${reqRow.reason === "wrong_number" ? "wrong number" : "switched off"}: ${reqRow.original_phone_number}`,
        link: `/dashboard/number-corrections/${id}`,
      });
      return NextResponse.json({ ok: true, recipients: recipients.length });
    }

    if (body.action === "reject") {
      // Either the supervisor rejects the initial report, or (once verified)
      // the assigned designation holder rejects the correction task.
      const isRecipient = !oversight && (await isAssignedRecipient(reqRow, session.user.id));
      if (!oversight && !isRecipient) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
      if (reqRow.status !== "pending") return NextResponse.json({ message: "No longer pending" }, { status: 409 });

      await query(
        `UPDATE number_correction_requests SET status = 'rejected', rejected_by_user_id = ?, rejected_at = NOW(), rejection_reason = ? WHERE id = ?`,
        [session.user.id, body.rejection_reason ? String(body.rejection_reason).slice(0, 500) : null, id]
      );
      logAudit(session, { action: "number_correction.reject", entityType: "number_correction_request", entityId: id, details: { reason: body.rejection_reason || null } });
      if (reqRow.reported_by_user_id) {
        notifyUsers([reqRow.reported_by_user_id], {
          type: "number_correction_rejected",
          title: `Correction rejected: ${reqRow.person_name}`,
          body: body.rejection_reason || null,
          link: `/dashboard/admin/number-corrections`,
        });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === "correct") {
      // Step 4: the designation holder supplies the fixed number — applied to
      // the contact immediately (that's the whole point), not just recorded.
      const isRecipient = !oversight && (await isAssignedRecipient(reqRow, session.user.id));
      if (!oversight && !isRecipient) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
      if (reqRow.status !== "pending") return NextResponse.json({ message: "No longer pending" }, { status: 409 });
      const newPhone = String(body.corrected_phone_number || "").trim();
      if (!newPhone) return NextResponse.json({ message: "corrected_phone_number is required" }, { status: 400 });

      const [dup] = await query("SELECT id, person_name FROM contacts WHERE phone_number = ? AND id != ?", [newPhone, reqRow.contact_id]);
      if (dup) {
        return NextResponse.json({ message: `That number is already used by another contact: ${dup.person_name} (ID ${dup.id}).` }, { status: 409 });
      }

      await query("UPDATE contacts SET phone_number = ? WHERE id = ?", [newPhone, reqRow.contact_id]);
      await query(
        `UPDATE number_correction_requests SET status = 'corrected', corrected_phone_number = ?, corrected_by_user_id = ?, corrected_at = NOW() WHERE id = ?`,
        [newPhone, session.user.id, id]
      );
      logAudit(session, { action: "number_correction.correct", entityType: "contact", entityId: reqRow.contact_id, details: { request_id: Number(id), old: reqRow.original_phone_number, new: newPhone } });

      const notifyIds = [reqRow.reported_by_user_id, reqRow.verified_by_user_id].filter((v, i, a) => v && a.indexOf(v) === i && v !== session.user.id);
      notifyUsers(notifyIds, {
        type: "number_correction_corrected",
        title: `Number corrected: ${reqRow.person_name}`,
        body: `${reqRow.original_phone_number} → ${newPhone}. Review and resolve.`,
        link: `/dashboard/admin/number-corrections`,
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "resolve") {
      // Step 5 (final close-out) — supervisor-only, closes the case whether it
      // ended in a correction or the supervisor is manually wrapping it up.
      if (!oversight) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
      if (reqRow.status === "resolved") return NextResponse.json({ message: "Already resolved" }, { status: 409 });
      await query(
        `UPDATE number_correction_requests SET status = 'resolved', resolved_by_user_id = ?, resolved_at = NOW() WHERE id = ?`,
        [session.user.id, id]
      );
      logAudit(session, { action: "number_correction.resolve", entityType: "number_correction_request", entityId: id });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ message: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("number-corrections/[id] PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
