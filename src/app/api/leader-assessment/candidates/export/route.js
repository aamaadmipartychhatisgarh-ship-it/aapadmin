import { NextResponse } from "next/server";
import { guard } from "@/lib/leaderAssessmentGuard";
import { buildCandidateListPdf } from "@/lib/leaderAssessmentPdf";

export const dynamic = "force-dynamic";

// POST /api/leader-assessment/candidates/export  { rows, subtitle }
// PDF of the AAP Candidate list the client currently shows (assembly filter /
// sort preserved). Each candidate's OWN photo is embedded server-side from
// durable storage by its photo_url. Guarded like the rest of Leader Assessment.
export async function POST(req) {
  const { error } = await guard();
  if (error) return error;
  try {
    const body = await req.json().catch(() => ({}));
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
    const subtitle = String(body.subtitle || `${rows.length} candidate${rows.length === 1 ? "" : "s"} · ${new Date().toLocaleString("en-GB")}`);
    const buf = await buildCandidateListPdf(rows, subtitle);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="AAP_Candidates_${new Date().toISOString().slice(0, 10)}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[LA] candidate PDF export:", e);
    return NextResponse.json({ message: "Could not generate the PDF. Please try again." }, { status: 500 });
  }
}
