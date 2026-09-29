import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { rejectLevel } from "@/lib/designationApprovals";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// POST /api/designation-approvals/[id]/reject  { reason }
// Rejects the current level (same per-level authorization as approve). The chain
// stops (status = rejected), the reason is stored, and the approval history is
// preserved — never deleted.
export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const { id } = await params;
    const d = await req.json().catch(() => ({}));
    const result = await rejectLevel(session, { req, assignmentId: id, reason: d.reason });
    if (result.error) return NextResponse.json({ message: result.error }, { status: result.status || 400, headers: NO_STORE });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    console.error("[approvals] reject:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
