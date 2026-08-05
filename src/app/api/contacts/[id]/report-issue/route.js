import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isCaller, isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";
import { logAudit } from "@/lib/audit";

// POST /api/contacts/:id/report-issue  { reason: 'wrong_number'|'switched_off', note? }
// Step 1 of the number-correction workflow: "Caller marks number." Creates a
// pending request a supervisor later verifies and routes to a Designation.
// Independent of the existing is_wrong_number flag (which is auto-derived
// from logging a call with the "Wrong Number" outcome) — this is a distinct,
// explicit "please get this fixed" request, not a call-outcome record.
export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !(isCaller(session) || isOversight(session))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const reason = body.reason;
    if (!["wrong_number", "switched_off"].includes(reason)) {
      return NextResponse.json({ message: "reason must be wrong_number or switched_off" }, { status: 400 });
    }

    const [contact] = await query("SELECT id, person_name, phone_number FROM contacts WHERE id = ?", [id]);
    if (!contact) return NextResponse.json({ message: "Contact not found" }, { status: 404 });

    const res = await query(
      `INSERT INTO number_correction_requests (contact_id, reason, note, original_phone_number, reported_by_user_id)
       VALUES (?, ?, ?, ?, ?)`,
      [contact.id, reason, body.note ? String(body.note).slice(0, 500) : null, contact.phone_number, session.user.id]
    );

    logAudit(session, {
      action: "number_correction.report", entityType: "contact", entityId: contact.id,
      details: { request_id: res.insertId, reason, phone_number: contact.phone_number },
    });

    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("report-issue POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
