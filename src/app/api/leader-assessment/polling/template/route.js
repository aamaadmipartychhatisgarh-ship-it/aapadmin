import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { query } from "@/lib/db";
import { guard } from "@/lib/leaderAssessmentGuard";
import { syncAssemblies } from "@/lib/leaderAssessment";
import { TEMPLATE_HEADERS } from "@/lib/pollingImport";

export const dynamic = "force-dynamic";

// GET /api/leader-assessment/polling/template — a ready-to-fill .xlsx sample for
// the Polling Station Master bulk import. Same page-key gate as the importer.
// The example rows use REAL master assembly names (+ their districts) so the
// admin sees exactly what a valid Assembly value looks like and can't guess a
// name that won't match. District/Lok Sabha/Zone are derived — the District
// column is only there to disambiguate assembly names that repeat across
// districts, and is optional.
export async function GET() {
  const { error } = await guard({ allowPageKeys: ["polling_master"] });
  if (error) return error;

  try {
    await syncAssemblies();
    const samples = await query(
      `SELECT ml.name AS assembly, dl.name AS district
         FROM la_assemblies a
         JOIN locations ml ON ml.id = a.location_id AND ml.type = 'assembly'
         LEFT JOIN locations dl ON dl.id = ml.parent_id AND dl.type = 'district'
        ORDER BY ml.name ASC
        LIMIT 2`
    );

    const exampleRows = (samples.length ? samples : [{ assembly: "Assembly Name", district: "District Name" }])
      .map((s, i) => [
        s.assembly,
        s.district || "",
        i === 0 ? 245000 : 198500,   // Total Voters
        i === 0 ? 126000 : 101200,   // Male Voters
        i === 0 ? 119000 : 97300,    // Female Voters
        i === 0 ? 312 : 264,         // Total Booths
      ]);

    const aoa = [TEMPLATE_HEADERS, ...exampleRows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 28 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Polling Station Master");
    const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(out, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="Polling_Station_Master_Template.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[LA] polling template:", e);
    return NextResponse.json({ message: "Could not generate the template." }, { status: 500 });
  }
}
