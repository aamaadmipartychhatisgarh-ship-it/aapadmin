import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { returnForCorrection } from "@/lib/designationApprovals";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// POST /api/designation-approvals/[id]/return  { reason }
// Sends the CURRENT stage back to the submitter for correction (same per-stage
// authorization as approve). The reason and actor are recorded; the workflow stops
// (status = returned) and nothing can be approved or certified until it is
// explicitly resubmitted, which restarts the chain from stage 1.
export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const { id } = await params;
    const d = await req.json().catch(() => ({}));
    const result = await returnForCorrection(session, { req, assignmentId: id, reason: d.reason });
    if (result.error) return NextResponse.json({ message: result.error }, { status: result.status || 400, headers: NO_STORE });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    console.error("[approvals] return:", err?.message || err);
    return NextResponse.json({ message: "Could not return this designation. Please try again." }, { status: 500, headers: NO_STORE });
  }
}
