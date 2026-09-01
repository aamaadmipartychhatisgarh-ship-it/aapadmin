import { NextResponse } from "next/server";
import { guard } from "@/lib/leaderAssessmentGuard";
import { syncAssemblies } from "@/lib/leaderAssessment";
import { fetchComparisonDataset } from "@/lib/mlaComparison";
import {
  buildComparisonWorkbookBuffer,
  buildComparisonPdfBuffer,
  comparisonExportFilename,
} from "@/lib/mlaComparisonExport";

export const dynamic = "force-dynamic";

// GET /api/leader-assessment/comparison/export?format=xlsx|pdf
//   &zone_id=&lok_sabha_id=&district_id=&assembly_id=   (same filters as the list)
//   &ids=12,34,56                                        (optional: selected assemblies)
//
// Exports the COMPLETE filtered comparison — NEVER limited to a pagination page
// (§10-§13). It rebuilds the dataset from the SAME source + filters the screen
// uses (§14), then, if `ids` is present, restricts to exactly those selected
// assemblies. Excel gets every column; PDF is a clean multi-page table.
export async function GET(req) {
  const { error } = await guard();
  if (error) return error;
  try {
    await syncAssemblies();
    const { searchParams } = new URL(req.url);
    const format = (searchParams.get("format") || "xlsx").toLowerCase();

    const filters = {
      zone_id: searchParams.get("zone_id"),
      lok_sabha_id: searchParams.get("lok_sabha_id"),
      district_id: searchParams.get("district_id"),
      assembly_id: searchParams.get("assembly_id"),
    };
    let rows = await fetchComparisonDataset(filters);

    // Optional explicit selection (assembly ids) — export only those rows.
    const idsParam = searchParams.get("ids");
    if (idsParam) {
      const ids = new Set(
        idsParam.split(",").map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0)
      );
      if (ids.size) rows = rows.filter((r) => ids.has(Number(r.assembly_id)));
    }

    const count = rows.length;
    const subtitle = `${count} assembl${count === 1 ? "y" : "ies"} · exported ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })}`;

    if (format === "pdf") {
      const buf = await buildComparisonPdfBuffer(rows, subtitle);
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${comparisonExportFilename("pdf")}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const buf = await buildComparisonWorkbookBuffer(rows);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${comparisonExportFilename("xlsx")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[LA] comparison export:", e);
    return NextResponse.json({ message: "Export failed." }, { status: 500 });
  }
}
