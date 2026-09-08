import { NextResponse } from "next/server";
import { requireSuperAdmin, NO_STORE, parseCommonFilters } from "@/lib/superAdminGuard";
import {
  getSummary, getGrowth, getAssemblyBreakdown, getWardBreakdown, getRanking,
} from "@/lib/membershipStats";
import { getCurrentCampaign } from "@/lib/campaign";

// Overview payload for the dashboard: summary cards, growth series, assembly &
// ward breakdown, top ranking and the current campaign — all server-aggregated,
// all respecting the selected period + geo filters. Super-Admin only.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET(req) {
  try {
    const { error } = await requireSuperAdmin();
    if (error) return error;
    const { searchParams } = new URL(req.url);
    const f = parseCommonFilters(searchParams);
    const bucket = searchParams.get("bucket") || "day";

    const [summary, growth, assemblies, wards, ranking, campaign] = await Promise.all([
      getSummary(f),
      getGrowth({ ...f, bucket }),
      getAssemblyBreakdown(f),
      getWardBreakdown(f),
      getRanking({ ...f, limit: 20 }),
      getCurrentCampaign(),
    ]);

    return NextResponse.json(
      { summary, growth, assemblies, wards, ranking, campaign },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error("[membership] summary error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
