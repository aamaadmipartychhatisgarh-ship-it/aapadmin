import { NextResponse } from "next/server";
import { requireSuperAdmin, NO_STORE } from "@/lib/superAdminGuard";
import { getMemberDetail } from "@/lib/membershipStats";

// Full member profile including the "Added By" worker. Super-Admin only.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET(_req, { params }) {
  try {
    const { error } = await requireSuperAdmin();
    if (error) return error;
    const { id } = await params;
    const mid = Number(id);
    if (!Number.isInteger(mid) || mid <= 0) return NextResponse.json({ message: "Invalid id." }, { status: 400, headers: NO_STORE });
    const member = await getMemberDetail(mid);
    if (!member) return NextResponse.json({ message: "Member not found." }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ member }, { headers: NO_STORE });
  } catch (err) {
    console.error("[membership] member detail error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
