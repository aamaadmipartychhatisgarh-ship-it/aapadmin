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

// POST (no body)               -> Evenly Distribute the whole available pool (unchanged)
// POST { count, caller_id? }   -> assign UP TO `count` available calls (a positive whole number), evenly
//                                 among the active callers or to the one chosen caller
const MAX_COUNT = 1000000;
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await allowed(session))) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const body = await req.json().catch(() => ({}));
    let limit = null, callerId = null;
    if (body && Object.prototype.hasOwnProperty.call(body, "count")) {
      const raw = body.count;
      if (typeof raw === "boolean" || raw === null || raw === "" || !/^\d+$/.test(String(raw).trim())) {
        return NextResponse.json({ message: "Enter a positive whole number of calls to assign." }, { status: 400, headers: NO_STORE });
      }
      limit = Number(String(raw).trim());
      if (!Number.isSafeInteger(limit) || limit < 1) return NextResponse.json({ message: "Enter a positive whole number of calls to assign (1 or more)." }, { status: 400, headers: NO_STORE });
      if (limit > MAX_COUNT) return NextResponse.json({ message: `Enter a number up to ${MAX_COUNT.toLocaleString("en-IN")}.` }, { status: 400, headers: NO_STORE });
    }
    if (body && body.caller_id != null && body.caller_id !== "") {
      if (!/^\d+$/.test(String(body.caller_id)) || Number(body.caller_id) < 1) return NextResponse.json({ message: "Invalid caller." }, { status: 400, headers: NO_STORE });
      callerId = Number(body.caller_id);
    }
    const result = await distributeUnfiltered({ byUserId: session.user.id, limit, callerId });
    await logAudit(session, {
      action: "unfiltered_contacts.distribute", entityType: "unfiltered_contacts", entityId: null,
      details: { requested: result.requested ?? undefined, remaining: result.remaining, pool: result.pool, assigned: result.assigned, callers: result.callers, per_caller: result.per_caller.map((c) => [c.user_id, c.assigned_now]) },
    }).catch(() => {});
    return NextResponse.json({ ...result, overview: await unfilteredAssignmentOverview() }, { headers: NO_STORE });
  } catch (err) {
    if (err?.status === 409 || err?.status === 400) return NextResponse.json({ message: err.message }, { status: err.status, headers: NO_STORE });
    console.error("unfiltered distribute error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
