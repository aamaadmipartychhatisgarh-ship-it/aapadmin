import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";
import { assemblyElectorate } from "@/lib/leaderAssessment";

export const dynamic = "force-dynamic";

// GET /api/leader-assessment/assemblies/[id]/electorate
// The authoritative Total Voters / Total Polling Stations / Total Booths for one
// assembly. Polling stations and booths are counted live from the geographic
// master (`locations`) as descendants of this assembly; voters come from the
// stored figure. All values are real numbers (0 when there's no data) — never
// dummy, never computed from unrelated frontend state. This endpoint is the
// single reliable source the Election History UI reads for these three metrics.
export async function GET(_req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { id } = await params;
    const [asm] = await query(
      "SELECT id, name, district, district_id, location_id, total_voters FROM la_assemblies WHERE id = ?",
      [id]
    );
    if (!asm) return NextResponse.json({ message: "Assembly not found." }, { status: 404 });
    const electorate = await assemblyElectorate(asm);
    return NextResponse.json(
      {
        assembly_id: Number(id),
        assembly_name: asm.name,
        district: asm.district || null,
        ...electorate,
      },
      { headers: noStore }
    );
  } catch (e) {
    console.error("[LA] electorate GET:", e);
    return NextResponse.json({ message: "Failed to load electorate data." }, { status: 500 });
  }
}
