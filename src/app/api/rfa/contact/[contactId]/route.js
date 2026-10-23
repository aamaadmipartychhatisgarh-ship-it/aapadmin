import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { normalizeRole, ROLES } from "@/lib/permissions";
import { query } from "@/lib/db";
import { notPendingClause } from "@/lib/contactExtras";
import { supervisorScopeFilter } from "@/lib/supervisorScope";
import { ensureRfaSchema } from "@/lib/rfa";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// GET /api/rfa/contact/[contactId] — the Super Admin's LATEST review of a Contact
// (status, reason, reviewer, time), read-only, for the Supervisor-2's Contact List.
// Backend rules: supervisor role only, and the Contact must be a live contact inside
// the supervisor's own territory — the same scope the supervisor's Contact List
// applies — so another area's contacts/reasons are never exposed (404).
export async function GET(_req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (normalizeRole(session.user?.role) !== ROLES.SUPERVISOR) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    const { contactId } = await params;
    const cid = parseInt(contactId, 10);
    if (!Number.isInteger(cid) || cid <= 0) return NextResponse.json({ message: "Invalid contact." }, { status: 400, headers: NO_STORE });
    await ensureRfaSchema();
    const scope = supervisorScopeFilter(session.user, "c");
    const notPending = await notPendingClause("c");
    const [c] = await query(`SELECT c.id FROM contacts c WHERE c.id = ? ${notPending} ${scope.where}`, [cid, ...scope.params]);
    if (!c) return NextResponse.json({ message: "Contact not found in your area." }, { status: 404, headers: NO_STORE });
    const [r] = await query(
      `SELECT id, status, review_remark AS remark, reviewed_by_name, reviewed_at, submitted_by_name, submitted_at
         FROM contact_rfa_reviews WHERE contact_id = ? ORDER BY id DESC LIMIT 1`,
      [cid]
    );
    if (!r) return NextResponse.json({ message: "No RfA review for this contact." }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ review: r }, { headers: NO_STORE });
  } catch (err) {
    console.error("[rfa] contact review:", err?.sqlMessage || err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
