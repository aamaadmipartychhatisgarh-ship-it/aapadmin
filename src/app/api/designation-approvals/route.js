import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isSuperAdmin } from "@/lib/permissions";
import { userCanAccessPageKey } from "@/lib/pageAccess";
import {
  APPROVAL_LEVELS, INITIATE_KEY, APPROVALS_PAGE_KEY,
  createAssignment, pendingForUser, processedByUser, initiatedByUser, listAllAssignments, finalApprovedFor, closedFor,
  approvalAccess, approvalCounts, getTimeline,
} from "@/lib/designationApprovals";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// Who may open the Designation Approval page at all: an oversight user, anyone
// granted the page, a granted initiator, or any approver. WHAT they see inside is
// always scoped server-side per view (an approver only ever sees records for the
// locations / stages they hold; "All records" is Super Admin / State Admin only).
async function canOpen(session, access) {
  if (!session) return false;
  if (isOversight(session)) return true;
  if (await userCanAccessPageKey(session, APPROVALS_PAGE_KEY)) return true;
  if (await userCanAccessPageKey(session, INITIATE_KEY)) return true;
  return access.levels.length > 0;
}
async function canInitiate(session) {
  return isSuperAdmin(session) || (await userCanAccessPageKey(session, INITIATE_KEY));
}

const intOrNull = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const dateOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const access = await approvalAccess(session);
    if (!(await canOpen(session, access))) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });

    const sp = new URL(req.url).searchParams;
    const view = sp.get("view") || (access.levels.length ? "pending" : "initiated");
    const filters = {
      q: (sp.get("q") || "").trim() || null,
      status: (sp.get("status") || "").trim() || null,
      level: intOrNull(sp.get("level")),
      designation_id: intOrNull(sp.get("designation_id")),
      assembly_id: intOrNull(sp.get("assembly_id")),
      district_id: intOrNull(sp.get("district_id")),
      lok_sabha_id: intOrNull(sp.get("lok_sabha_id")),
      from: dateOrNull(sp.get("from")),
      to: dateOrNull(sp.get("to")),
    };

    let rows = [];
    if (view === "pending") rows = await pendingForUser(session, filters);
    else if (view === "processed" || view === "approved") rows = await processedByUser(session, filters);
    else if (view === "initiated") rows = await initiatedByUser(session, filters);
    else if (view === "final") rows = await finalApprovedFor(session, filters);
    else if (view === "closed") rows = await closedFor(session, filters);
    else if (view === "all") {
      // Full visibility is an administrative privilege — never granted to ordinary approvers.
      if (!access.fullView) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
      rows = await listAllAssignments(session, filters);
    } else return NextResponse.json({ message: "Unknown view." }, { status: 400, headers: NO_STORE });

    return NextResponse.json(
      {
        assignments: rows,
        counts: await approvalCounts(session),
        meta: {
          levels: APPROVAL_LEVELS.map((l) => ({ level: l.level, label: l.label, scope: l.scope })),
          my_levels: access.levels,
          can_initiate: await canInitiate(session),
          can_view_all: access.fullView,
          view,
        },
      },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error("[approvals] GET:", err?.message || err);
    return NextResponse.json({ message: "Could not load designation approvals. Please try again." }, { status: 500, headers: NO_STORE });
  }
}

// Initiate a designation for an existing member. Creates it as Pending Approval at
// stage 1 — never final, never mutating the member record. Retrying the same
// request returns the existing workflow instead of creating a duplicate.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (!(await canInitiate(session))) return NextResponse.json({ message: "You are not allowed to initiate designation approvals." }, { status: 403, headers: NO_STORE });
    const d = await req.json().catch(() => ({}));
    const result = await createAssignment(session, { req, memberId: d.member_id, designationId: d.designation_id });
    if (result.error) return NextResponse.json({ message: result.error }, { status: 400, headers: NO_STORE });
    const timeline = await getTimeline(result.id);
    return NextResponse.json({ ok: true, id: result.id, existing: !!result.existing, timeline }, { status: result.existing ? 200 : 201, headers: NO_STORE });
  } catch (err) {
    console.error("[approvals] POST:", err?.message || err);
    return NextResponse.json({ message: "Could not submit the designation. Please try again." }, { status: 500, headers: NO_STORE });
  }
}
