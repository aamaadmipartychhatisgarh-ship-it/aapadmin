import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { logAudit } from "@/lib/audit";
import { removeUnfilteredAssignment, assignUnfilteredToCaller } from "@/lib/unfilteredContacts";

const NO_STORE = { "Cache-Control": "no-store" };

// PUT /api/unfiltered-contacts/:id/assignment   { caller_id, expected_caller_id? }
// Assigns / reassigns this contact to the selected active Caller (one mapping per contact).
export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "unfiltered_contacts", session && isAdmin(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const r = await assignUnfilteredToCaller({
      id, callerId: body.caller_id, byUserId: session.user.id,
      expectedCallerId: "expected_caller_id" in body ? Number(body.expected_caller_id) || 0 : undefined,
    });
    if (r.status === 200 && !r.no_change) {
      await logAudit(session, {
        action: "unfiltered_contacts.assign", entityType: "unfiltered_contact", entityId: String(id),
        details: { caller_id: r.caller_id, previous_caller_id: r.previous_caller_id },
      }).catch(() => {});
    }
    const { status, ...rest } = r;
    return NextResponse.json(rest, { status, headers: NO_STORE });
  } catch (err) {
    console.error("unfiltered assign error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

// DELETE /api/unfiltered-contacts/:id/assignment[?caller_id=N]
// Removes the Caller -> Unfiltered Contact assignment only. The contact and all its data and
// calling history stay; it returns to the assignment pool. Same authorization as managing
// Unfiltered Contacts (Assigned Calls / distribution).
export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "unfiltered_contacts", session && isAdmin(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const { id } = await params;
    const cid = new URL(req.url).searchParams.get("caller_id");
    const r = await removeUnfilteredAssignment({ id, expectedCallerId: cid ? Number(cid) : null });
    if (r.status === 200) {
      await logAudit(session, {
        action: "unfiltered_contacts.unassign", entityType: "unfiltered_contact", entityId: String(id),
        details: { removed_caller_id: r.removed_caller_id, completed: r.was_completed },
      }).catch(() => {});
    }
    const { status, ...rest } = r;
    return NextResponse.json(rest, { status, headers: NO_STORE });
  } catch (err) {
    console.error("unfiltered unassign error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
