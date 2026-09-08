import { NextResponse } from "next/server";
import { requireSuperAdmin, NO_STORE, parseCommonFilters } from "@/lib/superAdminGuard";
import { getRanking } from "@/lib/membershipStats";

// Top-N worker ranking by successfully-registered members (default Top 200),
// deterministic tie-break. Server-computed. Super-Admin only.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET(req) {
  try {
    const { error } = await requireSuperAdmin();
    if (error) return error;
    const { searchParams } = new URL(req.url);
    const f = parseCommonFilters(searchParams);
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "200", 10) || 200));
    const ranking = await getRanking({ ...f, limit });
    return NextResponse.json({ ranking, limit }, { headers: NO_STORE });
  } catch (err) {
    console.error("[membership] ranking error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
