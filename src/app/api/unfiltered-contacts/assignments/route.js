import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { logAudit } from "@/lib/audit";
import { unfilteredAssignmentOverview, distributeUnfiltered } from "@/lib/unfilteredContacts";

const NO_STORE = { "Cache-Control": "no-store" };
const allowed = async (session) => pageAllowed(session, "unfiltered_contacts", session && isAdmin(session));

// Assigned Calls for Unfiltered Contacts.
//   GET  → pool counts + caller-wise Assigned / Completed / Pending
//   POST → Evenly Distribute the available pool among active callers
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!(await allowed(session))) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    return NextResponse.json(await unfilteredAssignmentOverview(), { headers: NO_STORE });
  } catch (err) {
    console.error("unfiltered assignments GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!(await allowed(session))) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const result = await distributeUnfiltered({ byUserId: session.user.id });
    await logAudit(session, {
      action: "unfiltered_contacts.distribute", entityType: "unfiltered_contacts", entityId: null,
      details: { pool: result.pool, assigned: result.assigned, callers: result.callers, per_caller: result.per_caller.map((c) => [c.user_id, c.assigned_now]) },
    }).catch(() => {});
    return NextResponse.json({ ...result, overview: await unfilteredAssignmentOverview() }, { headers: NO_STORE });
  } catch (err) {
    if (err?.status === 409 || err?.status === 400) return NextResponse.json({ message: err.message }, { status: err.status, headers: NO_STORE });
    console.error("unfiltered distribute error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
