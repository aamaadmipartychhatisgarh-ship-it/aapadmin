import { NextResponse } from "next/server";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";
import { syncAssemblies } from "@/lib/leaderAssessment";
import { fetchComparisonDataset, comparisonSummary, fetchComparisonPartyTotals } from "@/lib/mlaComparison";

export const dynamic = "force-dynamic";

// GET /api/leader-assessment/comparison
//   ?zone_id=&lok_sabha_id=&district_id=&assembly_id=  (each a comma list; §9)
//   &page=&pageSize=                                    (server-side pagination; §13)
//
// Current MLA vs AAP Candidate VOTE comparison, one row per master assembly.
// Returns:
//   { data: [...currentPage], pagination: {page,pageSize,total,totalPages}, summary }
// The FULL filtered dataset drives `total` and `summary` (§8, §13) — pagination
// only slices `data`. The Excel/PDF exports call the SAME builder with the SAME
// filters, so screen and exports always agree (§14).
export async function GET(req) {
  const { error } = await guard();
  if (error) return error;
  try {
    // Keep the module's assembly mirror in step with Master Data before reading.
    await syncAssemblies();

    const { searchParams } = new URL(req.url);
    const filters = {
      zone_id: searchParams.get("zone_id"),
      lok_sabha_id: searchParams.get("lok_sabha_id"),
      district_id: searchParams.get("district_id"),
      assembly_id: searchParams.get("assembly_id"),
    };

    const all = await fetchComparisonDataset(filters);
    // Summary = per-assembly counts + party-wise vote totals (BJP/INC/AAP) over
    // the SAME filter scope, so the cards always agree with the filtered table.
    const partyTotals = await fetchComparisonPartyTotals(filters);
    const summary = { ...comparisonSummary(all), ...partyTotals };

    const total = all.length;
    const pageSize = Math.min(Math.max(parseInt(searchParams.get("pageSize") || "20", 10) || 20, 1), 200);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(parseInt(searchParams.get("page") || "1", 10) || 1, 1), totalPages);
    const start = (page - 1) * pageSize;
    const data = all.slice(start, start + pageSize);

    return NextResponse.json(
      { data, pagination: { page, pageSize, total, totalPages }, summary },
      { headers: noStore }
    );
  } catch (e) {
    console.error("[LA] comparison GET:", e);
    return NextResponse.json({ message: "Failed to load the comparison." }, { status: 500 });
  }
}
