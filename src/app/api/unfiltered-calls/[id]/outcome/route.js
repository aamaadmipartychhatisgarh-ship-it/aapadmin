import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isCaller } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { resolveActingUserId } from "@/lib/actAs";
import { updateCompletedUnfilteredCall } from "@/lib/unfilteredContacts";
import { logAudit } from "@/lib/audit";

// PUT /api/unfiltered-calls/[id]/outcome — re-edit the saved outcome (status, Phone Picked option, Wrong Number reason, remarks) of one of the
// acting caller's own COMPLETED Unfiltered Calls. Updates the same record and its latest log; never creates a call, log or contact.
export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "unfiltered_calls", session && isCaller(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { userId } = await resolveActingUserId(session);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const r = await updateCompletedUnfilteredCall({ id, callerId: userId, data: body });
    const { status, ...rest } = r;
    if (status === 200 && !rest.no_change) logAudit(session, { action: "unfiltered.outcome_edit", entityType: "unfiltered_contact", entityId: String(id), details: `Re-edited completed call: ${(rest.changed || []).join(", ")}` });
    return NextResponse.json(rest, { status });
  } catch (err) {
    console.error("unfiltered-calls outcome edit error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
