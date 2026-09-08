import { NextResponse } from "next/server";
import { requireSuperAdmin, NO_STORE } from "@/lib/superAdminGuard";
import { getWorkerDetail } from "@/lib/membershipStats";

// Individual worker performance: profile, period counts, rank + positions,
// growth series, and the members they added. Super-Admin only.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET(_req, { params }) {
  try {
    const { error } = await requireSuperAdmin();
    if (error) return error;
    const { id } = await params;
    const wid = Number(id);
    if (!Number.isInteger(wid) || wid <= 0) return NextResponse.json({ message: "Invalid id." }, { status: 400, headers: NO_STORE });
    const data = await getWorkerDetail(wid);
    if (!data) return NextResponse.json({ message: "Worker not found." }, { status: 404, headers: NO_STORE });
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (err) {
    console.error("[membership] worker detail error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
