import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isSuperAdmin } from "@/lib/permissions";
import { userCanAccessPageKey } from "@/lib/pageAccess";
import {
  APPROVAL_LEVELS, INITIATE_KEY, APPROVALS_PAGE_KEY,
  createAssignment, pendingForUser, approvedByUser, initiatedByUser, listAllAssignments,
  userApprovalLevels, approvalCounts, getTimeline,
} from "@/lib/designationApprovals";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// Who may open the Approval Center at all: an oversight user, anyone granted the
// approvals page or any level grant, or a granted initiator. Everything below is
// still scoped per view (an approver only ever sees their own pending/approved).
async function canView(session) {
  if (!session) return false;
  if (isOversight(session)) return true;
  if (await userCanAccessPageKey(session, APPROVALS_PAGE_KEY)) return true;
  if (await userCanAccessPageKey(session, INITIATE_KEY)) return true;
  const levels = await userApprovalLevels(session);
  return levels.length > 0;
}
async function canInitiate(session) {
  return isSuperAdmin(session) || isOversight(session) || (await userCanAccessPageKey(session, INITIATE_KEY));
}

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await canView(session))) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    const sp = new URL(req.url).searchParams;
    const view = sp.get("view") || "pending";
    const filters = {
      q: (sp.get("q") || "").trim() || null,
      status: (sp.get("status") || "").trim() || null,
      level: sp.get("level") ? parseInt(sp.get("level"), 10) : null,
      assembly_id: sp.get("assembly_id") ? parseInt(sp.get("assembly_id"), 10) : null,
      district_id: sp.get("district_id") ? parseInt(sp.get("district_id"), 10) : null,
      lok_sabha_id: sp.get("lok_sabha_id") ? parseInt(sp.get("lok_sabha_id"), 10) : null,
    };

    let rows = [];
    if (view === "pending") rows = await pendingForUser(session, filters);
    else if (view === "approved") rows = await approvedByUser(session, filters);
    else if (view === "initiated") rows = await initiatedByUser(session, filters);
    else if (view === "all") {
      if (!(isOversight(session) || (await userCanAccessPageKey(session, APPROVALS_PAGE_KEY)))) {
        return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
      }
      rows = await listAllAssignments(filters);
    }

    const myLevels = await userApprovalLevels(session);
    const counts = await approvalCounts(session);
    return NextResponse.json(
      {
        assignments: rows,
        counts,
        meta: {
          levels: APPROVAL_LEVELS.map((l) => ({ level: l.level, label: l.label })),
          my_levels: myLevels,
          can_initiate: await canInitiate(session),
          can_view_all: isOversight(session) || (await userCanAccessPageKey(session, APPROVALS_PAGE_KEY)),
        },
      },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error("[approvals] GET:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

// Initiate a designation (Vidhansabha Prabhari). Creates it as Pending Approval —
// never final, never mutating the member record.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (!(await canInitiate(session))) return NextResponse.json({ message: "You are not allowed to initiate designation approvals." }, { status: 403, headers: NO_STORE });
    const d = await req.json().catch(() => ({}));
    const result = await createAssignment(session, { req, memberId: d.member_id, designationId: d.designation_id });
    if (result.error) return NextResponse.json({ message: result.error }, { status: 400, headers: NO_STORE });
    const timeline = await getTimeline(result.id);
    return NextResponse.json({ ok: true, id: result.id, timeline }, { status: 201, headers: NO_STORE });
  } catch (err) {
    console.error("[approvals] POST:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
