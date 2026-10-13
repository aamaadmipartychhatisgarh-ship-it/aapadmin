import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { levelConfig, getAssignment, getTimeline, getHistory, approvalAccess, eligibleApprovers } from "@/lib/designationApprovals";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// GET /api/designation-approvals/[id] — the assignment, its full 8-stage timeline and
// its append-only history. The record is returned ONLY to someone who may see it
// (Super/State Admin, its submitter, an approver responsible for its location or a
// state-level stage) — knowing the id is never enough. The action flags below mirror
// the backend rules so the UI shows the right controls; they are never the authority.
export async function GET(_req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const { id } = await params;
    const iid = parseInt(id, 10);
    if (!Number.isInteger(iid) || iid <= 0) return NextResponse.json({ message: "Invalid id." }, { status: 400, headers: NO_STORE });

    const assignment = await getAssignment(iid);
    if (!assignment) return NextResponse.json({ message: "Not found." }, { status: 404, headers: NO_STORE });

    const access = await approvalAccess(session);
    if (!access.canSee(assignment)) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });

    const [timeline, history] = await Promise.all([getTimeline(iid), getHistory(iid)]);
    const cfg = assignment.status === "pending" ? levelConfig(assignment.current_level) : null;
    const canActNow = access.canActNow(assignment);

    // A missing-approver warning is an administrative concern: only shown to people
    // who can see everything or who submitted the record.
    let missingApprover = null;
    if (cfg && (access.fullView || String(access.uid) === String(assignment.assigned_by_user_id))) {
      const who = await eligibleApprovers(cfg.level, assignment);
      if (!who.length) {
        missingApprover = `No ${cfg.label} is mapped${cfg.scope ? ` for ${assignment[`${cfg.scope}_name`] || "this location"}` : ""}. The record stays pending at stage ${cfg.level} until one is assigned.`;
      }
    }
    const mayResubmit = ["returned", "rejected", "pending"].includes(assignment.status) &&
      (access.fullView || String(assignment.assigned_by_user_id) === String(access.uid));

    return NextResponse.json(
      {
        assignment, timeline, history,
        can_approve_now: canActNow,
        can_return_now: canActNow,
        can_resubmit: mayResubmit,
        current_level_label: cfg?.label || null,
        missing_approver: missingApprover,
      },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error("[approvals] detail GET:", err?.message || err);
    return NextResponse.json({ message: "Could not load this record. Please try again." }, { status: 500, headers: NO_STORE });
  }
}
