import { NextResponse } from "next/server";
import { guard } from "@/lib/leaderAssessmentGuard";
import { buildMlaListPdf } from "@/lib/leaderAssessmentPdf";
import { buildMlaListWorkbook } from "@/lib/leaderAssessmentExcel";

export const dynamic = "force-dynamic";

// POST /api/leader-assessment/mlas/export  { rows, subtitle, format, columns }
// Builds a PDF or Excel of the MLA Profile list the client currently shows (so
// any search / party filter is preserved). `columns` (optional key list) selects
// which columns appear — the SAME selection drives both formats. Each row's OWN
// photo is embedded server-side from durable storage by its photo_url. Guarded
// like the rest of Leader Assessment.
export async function POST(req) {
  const { error } = await guard();
  if (error) return error;
  try {
    const body = await req.json().catch(() => ({}));
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
    const format = String(body.format || "pdf").toLowerCase();
    const cols = Array.isArray(body.columns) && body.columns.length ? body.columns : null;
    const subtitle = String(body.subtitle || `${rows.length} MLA${rows.length === 1 ? "" : "s"} · ${new Date().toLocaleString("en-GB")}`);
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === "xlsx") {
      const buf = await buildMlaListWorkbook(rows, cols);
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="MLA_Profiles_${stamp}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const buf = await buildMlaListPdf(rows, subtitle, cols);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="MLA_Profiles_${stamp}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[LA] mla export:", e);
    return NextResponse.json({ message: "Could not generate the export. Please try again." }, { status: 500 });
  }
}
