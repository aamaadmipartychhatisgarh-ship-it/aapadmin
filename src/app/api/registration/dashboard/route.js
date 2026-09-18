import { NextResponse } from "next/server";
import { requireRegistrationAccess, NO_STORE, parseRegFilters } from "@/lib/registrationGuard";
import { getRegSummary, getWorkerRanking, getBlockRanking, getWardOptions, getAssemblyRegistrationCounts } from "@/lib/registrationStats";

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
    // Worker ranking shows the Top 200; Block (Area/Booth) ranking the Top 100 (§9).
    const workerLimit = Math.min(200, Math.max(1, parseInt(searchParams.get("worker_limit") || "200", 10) || 200));
    const blockLimit = Math.min(100, Math.max(1, parseInt(searchParams.get("block_limit") || "100", 10) || 100));

    const [summary, workers, blocks, wardOptions, assemblies] = await Promise.all([
      getRegSummary(f),
      getWorkerRanking({ ...f, limit: workerLimit }),
      getBlockRanking({ ...f, limit: blockLimit }), // Top 100 blocks by area_booth (§9B)
      getWardOptions(f.campaignId),
      getAssemblyRegistrationCounts(f), // all 90 assemblies, voter/worker counts (§8)
    ]);

    return NextResponse.json({ summary, workers, blocks, wardOptions, assemblies }, { headers: NO_STORE });
  } catch (e) {
    console.error("[registration] dashboard GET error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
