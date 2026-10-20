import { NextResponse } from "next/server";
import { guard } from "@/lib/leaderAssessmentGuard";
import { syncAssemblies } from "@/lib/leaderAssessment";
import { fetchComparisonDataset } from "@/lib/mlaComparison";
import { query } from "@/lib/db";
import { ASSEMBLY_CATEGORY_LABEL, normalizeAssemblyCategory } from "@/lib/assemblyCategoryOptions";
import {
  buildComparisonWorkbookBuffer,
  buildComparisonPdfBuffer,
  comparisonExportFilename,
} from "@/lib/mlaComparisonExport";

export const dynamic = "force-dynamic";

// GET /api/leader-assessment/comparison/export?format=xlsx|pdf
//   &zone_id=&lok_sabha_id=&district_id=&assembly_id=   (same filters as the list)
//   &party=&category=                                    (Party / Assembly Category filters)
//   &ids=12,34,56                                        (optional: selected assemblies)
//   &disposition=inline                                  (PDF opened for Print instead of download)
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
      party: searchParams.get("party"),
      category: searchParams.get("category"),
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
      const criteria = await describeCriteria(filters, idsParam ? count : 0);
      const buf = await buildComparisonPdfBuffer(rows, { subtitle, criteria });
      const inline = searchParams.get("disposition") === "inline";
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${comparisonExportFilename("pdf")}"`,
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

// The comparison criteria in words ("District: Raipur, Durg", "Party: BJP", …) for
// the PDF header, resolving location ids to their master names.
async function describeCriteria(filters, selectedCount) {
  const out = [];
  const LEVELS = [["zone_id", "Zone"], ["lok_sabha_id", "Lok Sabha"], ["district_id", "District"], ["assembly_id", "Assembly"]];
  for (const [key, label] of LEVELS) {
    const ids = String(filters[key] || "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) continue;
    const names = await query(`SELECT name FROM locations WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY name`, ids).catch(() => []);
    out.push(`${label}: ${names.map((r) => r.name).join(", ") || ids.join(", ")}`);
  }
  if (String(filters.party || "").trim()) out.push(`Party: ${String(filters.party).trim()}`);
  const cat = normalizeAssemblyCategory(filters.category);
  if (cat) out.push(`Category: ${ASSEMBLY_CATEGORY_LABEL[cat]} Assembly`);
  if (selectedCount) out.push(`Selected rows only (${selectedCount})`);
  if (!out.length) out.push("All assemblies (no filters)");
  return out;
}
