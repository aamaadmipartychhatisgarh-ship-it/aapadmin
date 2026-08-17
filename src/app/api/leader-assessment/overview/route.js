import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";
import { ASSESSMENT_PARAMS, assessmentTotal, syncAssemblies } from "@/lib/leaderAssessment";

export const dynamic = "force-dynamic";

// GET /api/leader-assessment/overview — module dashboard stats. All derived from
// the DB; empty module → clean zeros (not fake data).
export async function GET() {
  const { error } = await guard();
  if (error) return error;
  try {
    // Refresh the mirror so a just-added/edited/removed master assembly is
    // reflected on this request (survives browser refresh, no stale cache).
    await syncAssemblies();
    // Total Assembly = the live count of authoritative Master Data assemblies
    // (locations type='assembly'). Computed dynamically from the master table —
    // never hardcoded — so it always equals the real number (90 today, whatever
    // it becomes tomorrow) and tracks Master Data automatically.
    const totRows = await query("SELECT COUNT(*) AS n FROM locations WHERE type = 'assembly'");
    const a = { total: Number(totRows[0]?.n || 0) };
    const [[wm]] = await query("SELECT COUNT(*) AS n FROM la_mla_profiles WHERE name IS NOT NULL AND name <> ''").then((r) => [r]);
    const [[wc]] = await query("SELECT COUNT(DISTINCT assembly_id) AS n FROM la_aap_candidates").then((r) => [r]);
    const [[tc]] = await query("SELECT COUNT(*) AS n FROM la_aap_candidates").then((r) => [r]);
    const [[ad]] = await query("SELECT COUNT(*) AS n FROM la_candidate_assessments").then((r) => [r]);

    // Average score + top-ranked candidates (across all assemblies).
    const rows = await query(
      `SELECT c.id, c.name, c.assembly_id, asm.name AS assembly_name, ${ASSESSMENT_PARAMS.map((p) => `s.${p.key}`).join(", ")}
         FROM la_candidate_assessments s
         JOIN la_aap_candidates c ON c.id = s.candidate_id
         JOIN la_assemblies asm ON asm.id = c.assembly_id`
    );
    const scored = rows.map((r) => ({ id: r.id, name: r.name, assembly_id: r.assembly_id, assembly_name: r.assembly_name, total: assessmentTotal(r) }));
    const avg = scored.length ? Math.round((scored.reduce((s, r) => s + r.total, 0) / scored.length) * 10) / 10 : 0;
    const top = [...scored].sort((x, y) => y.total - x.total).slice(0, 5);

    // ---- Assembly-wise Top Ranking -------------------------------------------
    // ONE consistent Assembly Ranking Score, used here and reusable everywhere:
    //   Assembly Score = the assembly's TOP AAP candidate total assessment
    //   (0–100) — the only approved assessment score the system computes (the
    //   MLA is not scored on the 10 parameters, so MLA Assessment Score is N/A).
    // Ranked highest → lowest, computed live from the assessments above.
    const topCandByAsm = new Map();   // assembly_id -> best candidate total
    for (const c of scored) {
      const prev = topCandByAsm.get(c.assembly_id);
      if (prev == null || c.total > prev) topCandByAsm.set(c.assembly_id, c.total);
    }
    // Sitting-MLA assessment total per assembly (0–100), when the MLA has been
    // scored on the same 10 parameters.
    const mlaScoreRows = await query(
      `SELECT mp.assembly_id, ${ASSESSMENT_PARAMS.map((p) => `s.${p.key}`).join(", ")}
         FROM la_mla_profiles mp
         JOIN la_mla_assessments s ON s.mla_id = mp.id`
    );
    const mlaScoreByAsm = new Map();
    for (const r of mlaScoreRows) mlaScoreByAsm.set(r.assembly_id, assessmentTotal(r));
    // Authoritative assembly meta (Master Data name + parent district) + sitting MLA.
    const asmMeta = await query(
      `SELECT a.id AS assembly_id, ml.name AS assembly_name,
              dl.name AS district, mp.name AS mla_name
         FROM la_assemblies a
         JOIN locations ml ON ml.id = a.location_id AND ml.type = 'assembly'
         LEFT JOIN locations dl ON dl.id = ml.parent_id AND dl.type = 'district'
         LEFT JOIN la_mla_profiles mp ON mp.assembly_id = a.id`
    );
    const topAssemblies = asmMeta
      .map((m) => {
        const assemblyScore = topCandByAsm.has(m.assembly_id) ? topCandByAsm.get(m.assembly_id) : null;
        return {
          assembly_id: m.assembly_id,
          assembly_name: m.assembly_name,
          district: m.district || null,
          mla_name: m.mla_name || null,
          mla_score: mlaScoreByAsm.has(m.assembly_id) ? mlaScoreByAsm.get(m.assembly_id) : null,
          top_candidate_score: assemblyScore,
          assembly_score: assemblyScore,   // the ranking score (approved overall assembly score)
        };
      })
      // Only rank assemblies that actually have an assessment score.
      .filter((m) => m.assembly_score != null)
      .sort((x, y) => y.assembly_score - x.assembly_score)
      .slice(0, 10)
      .map((m, i) => ({ ...m, rank: i + 1 }));

    return NextResponse.json({
      stats: {
        total_assemblies: Number(a.total) || 0,
        assemblies_with_mla: Number(wm.n) || 0,
        assemblies_with_candidates: Number(wc.n) || 0,
        total_candidates: Number(tc.n) || 0,
        assessments_completed: Number(ad.n) || 0,
        average_score: avg,
      },
      top_candidates: top,
      top_assemblies: topAssemblies,
    }, { headers: noStore });
  } catch (e) {
    console.error("[LA] overview GET:", e);
    return NextResponse.json({ message: "Failed to load the overview." }, { status: 500 });
  }
}
