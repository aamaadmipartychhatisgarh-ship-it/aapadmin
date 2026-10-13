import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { reviseAssignment } from "@/lib/designationApprovals";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// POST /api/designation-approvals/[id]/resubmit  { designation_id?, reason? }
// Explicitly resubmits a returned / rejected designation (or revises a pending one).
// The chain RESTARTS at stage 1 so a corrected or changed designation can never
// bypass a required approval; every earlier action stays in the append-only
// history. A finally approved designation cannot be changed here.
export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const { id } = await params;
    const d = await req.json().catch(() => ({}));
    const result = await reviseAssignment(session, { req, assignmentId: id, designationId: d.designation_id, reason: d.reason });
    if (result.error) return NextResponse.json({ message: result.error }, { status: result.status || 400, headers: NO_STORE });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    console.error("[approvals] resubmit:", err?.message || err);
    return NextResponse.json({ message: "Could not resubmit this designation. Please try again." }, { status: 500, headers: NO_STORE });
  }
}
