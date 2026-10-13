import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { userCanAccessPageKey } from "@/lib/pageAccess";
import { APPROVALS_PAGE_KEY, assertCertificateAllowed, issueCertificate, getAssignment, approvalAccess } from "@/lib/designationApprovals";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// Certificate access follows the existing permission model (oversight or the
// approvals page grant) AND the record-level rule: you can only touch a certificate
// for a designation you are allowed to see — knowing an id is never enough.
async function canManage(session, assignmentId) {
  if (!session?.user) return false;
  if (!(isOversight(session) || (await userCanAccessPageKey(session, APPROVALS_PAGE_KEY)))) return false;
  const a = await getAssignment(assignmentId);
  if (!a) return true; // let the gate below return the proper 404
  return (await approvalAccess(session)).canSee(a);
}

// GET — the certificate's status + (when allowed) its finalized data. This ALSO
// enforces the gate: if the 8-stage approval isn't complete, the data is refused.
export async function GET(_req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    const { id } = await params;
    const iid = parseInt(id, 10);
    if (!(await canManage(session, iid))) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
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
        block_name: a.block_name,
        assembly_name: a.assembly_name,
        district_name: a.district_name,
        lok_sabha_name: a.lok_sabha_name,
        final_approved_at: a.final_approved_at,
        final_approved_by: a.final_approved_by_name,
        issued_at: a.certificate_issued_at,
        issued_by: a.certificate_issued_by_name,
      },
    }, { headers: NO_STORE });
  } catch (err) {
    console.error("[approvals] certificate GET:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

// POST — generate / issue the certificate. HARD backend gate: refused unless all 8
// stages are approved and the designation is FINAL APPROVED, regardless of the UI.
export async function POST(_req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    const { id } = await params;
    const iid = parseInt(id, 10);
    if (!(await canManage(session, iid))) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    const result = await issueCertificate(session, { assignmentId: iid });
    if (result.error) return NextResponse.json({ message: result.error }, { status: result.status || 409, headers: NO_STORE });
    return NextResponse.json({ ok: true, assignment: result.assignment }, { headers: NO_STORE });
  } catch (err) {
    console.error("[approvals] certificate POST:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
