import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";
import { ASSESSMENT_PARAMS, assessmentTotal, ageFromDob, syncAssemblies } from "@/lib/leaderAssessment";

export const dynamic = "force-dynamic";

// GET /api/leader-assessment/mlas
// The complete, database-driven MLA Data List — one row per MLA profile. Each
// carries its assembly + authoritative district (from the master-linked
// la_assemblies -> locations), party, its 10-parameter assessment score/status,
// and every editable profile field so the Open view is complete without a
// second fetch. INNER JOIN to the master assembly guarantees only MLAs of
// existing master assemblies appear; la_mla_profiles is unique per assembly, so
// there are never duplicate MLA rows.
export async function GET() {
  const { error } = await guard();
  if (error) return error;
  try {
    await syncAssemblies();
    const rows = await query(
      `SELECT mp.*, a.id AS la_assembly_id,
              ml.name AS assembly_name, COALESCE(dl.name, a.district) AS district,
              ${ASSESSMENT_PARAMS.map((p) => `s.${p.key}`).join(", ")}
         FROM la_mla_profiles mp
         JOIN la_assemblies a ON a.id = mp.assembly_id
         JOIN locations ml ON ml.id = a.location_id AND ml.type = 'assembly'
         LEFT JOIN locations dl ON dl.id = ml.parent_id AND dl.type = 'district'
         LEFT JOIN la_mla_assessments s ON s.mla_id = mp.id
        WHERE mp.name IS NOT NULL AND mp.name <> ''
        ORDER BY ml.name ASC`
    );
    const mlas = rows.map((r) => {
      const assessment = {};
      let anyScore = false;
      for (const p of ASSESSMENT_PARAMS) { assessment[p.key] = r[p.key]; if (r[p.key] != null) anyScore = true; }
      return {
        id: r.id,
        assembly_id: r.assembly_id,
        assembly_name: r.assembly_name || null,
        district: r.district || null,
        photo_url: r.photo_url,
        name: r.name,
        phone: r.phone,
        address: r.address,
        date_of_birth: r.date_of_birth,
        age: ageFromDob(r.date_of_birth),
        caste: r.caste,
        party: r.party,
        net_worth: r.net_worth,
        criminal_cases: r.criminal_cases,
        times_won: r.times_won,
        times_contested: r.times_contested,
        largest_winning_margin: r.largest_winning_margin,
        previous_winning_margin: r.previous_winning_margin,
        party_won_from: r.party_won_from,
        party_defeated: r.party_defeated,
        assessment,
        total: assessmentTotal(assessment),
        assessment_done: anyScore,
      };
    });
    return NextResponse.json({ mlas }, { headers: noStore });
  } catch (e) {
    console.error("[LA] mlas list GET:", e);
    return NextResponse.json({ message: "Failed to load MLAs." }, { status: 500 });
  }
}
