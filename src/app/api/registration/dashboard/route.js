import { NextResponse } from "next/server";
import { requireRegistrationAccess, NO_STORE, parseRegFilters } from "@/lib/registrationGuard";
import { getRegSummary, getWorkerRanking, getWardRanking, getWardOptions } from "@/lib/registrationStats";

// One payload for the whole dashboard — KPIs, the Top 10 worker ranking, the
// ward ranking and the ward filter options. Sending them together keeps every
// number on screen computed from the same filters at the same instant, instead of
// four requests that can disagree mid-refresh.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET(req) {
  try {
    const { error } = await requireRegistrationAccess();
    if (error) return error;
    const { searchParams } = new URL(req.url);
    const f = parseRegFilters(searchParams);
    const workerLimit = Math.min(100, Math.max(1, parseInt(searchParams.get("worker_limit") || "10", 10) || 10));
    const wardLimit = Math.min(100, Math.max(1, parseInt(searchParams.get("ward_limit") || "20", 10) || 20));

    const [summary, workers, wards, wardOptions] = await Promise.all([
      getRegSummary(f),
      getWorkerRanking({ ...f, limit: workerLimit }),
      getWardRanking({ ...f, limit: wardLimit }),
      getWardOptions(f.campaignId),
    ]);

    return NextResponse.json({ summary, workers, wards, wardOptions }, { headers: NO_STORE });
  } catch (e) {
    console.error("[registration] dashboard GET error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
