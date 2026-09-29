import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { approveLevel } from "@/lib/designationApprovals";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// POST /api/designation-approvals/[id]/approve  { signature, remarks }
// Approves the CURRENT pending level. All enforcement (sequence, per-level grant,
// concurrency, duplicate prevention) lives in approveLevel() — the client's role /
// level / user id are never trusted; the approver is the authenticated session.
export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const { id } = await params;
    const d = await req.json().catch(() => ({}));
    const result = await approveLevel(session, { req, assignmentId: id, signature: d.signature, remarks: d.remarks });
    if (result.error) return NextResponse.json({ message: result.error }, { status: result.status || 400, headers: NO_STORE });
    return NextResponse.json({ ok: true, finalized: !!result.finalized }, { headers: NO_STORE });
  } catch (err) {
    console.error("[approvals] approve:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
