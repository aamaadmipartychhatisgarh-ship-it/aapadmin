import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { userCanAccessPageKey } from "@/lib/pageAccess";
import { APPROVALS_PAGE_KEY, assertCertificateAllowed, issueCertificate, getAssignment } from "@/lib/designationApprovals";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

async function canManage(session) {
  return !!session && (isOversight(session) || (await userCanAccessPageKey(session, APPROVALS_PAGE_KEY)));
}

// GET — the certificate's status + (when allowed) its finalized data. This ALSO
// enforces the gate: if the 7-level approval isn't complete, the data is refused.
export async function GET(_req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await canManage(session))) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    const { id } = await params;
    const iid = parseInt(id, 10);
    const gate = await assertCertificateAllowed(iid);
    if (gate.error) return NextResponse.json({ available: false, message: gate.error }, { status: 200, headers: NO_STORE });
    const a = gate.assignment;
    return NextResponse.json({
      available: true,
      certificate: {
        certificate_number: a.certificate_number,
        certificate_status: a.certificate_status,
        member_name: a.member_name,
        designation_name: a.designation_name,
        assembly_name: a.assembly_name,
        district_name: a.district_name,
        lok_sabha_name: a.lok_sabha_name,
        final_approved_at: a.final_approved_at,
        issued_at: a.certificate_issued_at,
      },
    }, { headers: NO_STORE });
  } catch (err) {
    console.error("[approvals] certificate GET:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

// POST — generate / issue the certificate. HARD backend gate: refused unless all 7
// levels are approved and the designation is FINAL APPROVED, regardless of the UI.
export async function POST(_req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await canManage(session))) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    const { id } = await params;
    const iid = parseInt(id, 10);
    const result = await issueCertificate(session, { assignmentId: iid });
    if (result.error) return NextResponse.json({ message: result.error }, { status: result.status || 409, headers: NO_STORE });
    return NextResponse.json({ ok: true, assignment: result.assignment }, { headers: NO_STORE });
  } catch (err) {
    console.error("[approvals] certificate POST:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
