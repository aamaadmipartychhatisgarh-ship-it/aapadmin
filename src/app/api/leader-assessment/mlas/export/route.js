import { NextResponse } from "next/server";
import { guard } from "@/lib/leaderAssessmentGuard";
import { buildMlaListPdf } from "@/lib/leaderAssessmentPdf";

export const dynamic = "force-dynamic";

// POST /api/leader-assessment/mlas/export  { rows, subtitle }
// Builds a PDF of the MLA Profile list the client currently shows (so any
// search / party filter is preserved). Each row's OWN photo is embedded
// server-side from durable storage by its photo_url — text comes from the
// already-displayed rows. Guarded like the rest of Leader Assessment.
export async function POST(req) {
  const { error } = await guard();
  if (error) return error;
  try {
    const body = await req.json().catch(() => ({}));
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
    const subtitle = String(body.subtitle || `${rows.length} MLA${rows.length === 1 ? "" : "s"} · ${new Date().toLocaleString("en-GB")}`);
    const buf = await buildMlaListPdf(rows, subtitle);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="MLA_Profiles_${new Date().toISOString().slice(0, 10)}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[LA] mla PDF export:", e);
    return NextResponse.json({ message: "Could not generate the PDF. Please try again." }, { status: 500 });
  }
}
