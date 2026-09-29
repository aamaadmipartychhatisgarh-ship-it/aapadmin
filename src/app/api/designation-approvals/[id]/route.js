import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { userCanAccessPageKey } from "@/lib/pageAccess";
import {
  APPROVALS_PAGE_KEY, INITIATE_KEY, levelConfig, getAssignment, getTimeline, userApprovalLevels,
} from "@/lib/designationApprovals";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// GET /api/designation-approvals/[id] — the assignment + its full 7-step timeline,
// plus whether THIS user may act on the current level (drives the Approve control).
export async function GET(_req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const { id } = await params;
    const iid = parseInt(id, 10);
    if (!Number.isInteger(iid) || iid <= 0) return NextResponse.json({ message: "Invalid id." }, { status: 400, headers: NO_STORE });

    const assignment = await getAssignment(iid);
    if (!assignment) return NextResponse.json({ message: "Not found." }, { status: 404, headers: NO_STORE });

    const myLevels = await userApprovalLevels(session);
    const canView = isOversight(session)
      || (await userCanAccessPageKey(session, APPROVALS_PAGE_KEY))
      || (await userCanAccessPageKey(session, INITIATE_KEY))
      || myLevels.length > 0
      || assignment.assigned_by_user_id === session.user.id;
    if (!canView) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });

    const timeline = await getTimeline(iid);
    // The user may approve ONLY the current pending level AND only if it is one of
    // their granted levels — this mirrors the backend enforcement so the UI can show
    // the Approve control accurately without ever being the source of truth.
    const cfg = assignment.status === "pending" ? levelConfig(assignment.current_level) : null;
    const canApproveNow = !!cfg && myLevels.includes(assignment.current_level);
    return NextResponse.json(
      { assignment, timeline, can_approve_now: canApproveNow, current_level_label: cfg?.label || null },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error("[approvals] detail GET:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
