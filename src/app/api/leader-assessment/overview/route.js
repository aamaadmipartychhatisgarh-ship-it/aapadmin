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

    // Completion rules — each card has its OWN exact definition; they are never
    // mixed. All computed from live DB records, never counting empty/placeholder
    // rows as complete.
    //   • MLA complete       — an MLA profile exists for the assembly with a real
    //                          (non-blank) name (an empty MLA record never counts).
    //   • Candidate complete — a candidate record with a real (non-blank) name
    //                          (a partial/placeholder row never counts).
    //   • Assessment complete — ALL 10 assessment parameters are filled (> 0);
    //                          if even one is missing the candidate is not "done".
    const MLA_COMPLETE = "mp.name IS NOT NULL AND TRIM(mp.name) <> ''";
    const CAND_COMPLETE = "c.name IS NOT NULL AND TRIM(c.name) <> ''";
    const ALL_PARAMS = ASSESSMENT_PARAMS.map((p) => `COALESCE(s.${p.key}, 0) > 0`).join(" AND ");

    // CARD 2 — With MLA Data: assemblies whose MLA profile is complete
    // (la_mla_profiles has one row per assembly).
    const [[wm]] = await query(
      `SELECT COUNT(*) AS n FROM la_mla_profiles mp WHERE ${MLA_COMPLETE}`
    ).then((r) => [r]);

    // CARD 3 — With Candidates Data: assemblies where ALL THREE candidates are
    // complete (an assembly caps at 3 candidates, so >= 3 complete = all 3).
    const [[wc]] = await query(
      `SELECT COUNT(*) AS n FROM (
         SELECT c.assembly_id
           FROM la_aap_candidates c
          WHERE ${CAND_COMPLETE}
          GROUP BY c.assembly_id
         HAVING COUNT(*) >= 3
       ) t`
    ).then((r) => [r]);

    // CARD 4 — Total Candidates: valid (complete-named) candidate records only —
    // no empty/placeholder rows.
    const [[tc]] = await query(
      `SELECT COUNT(*) AS n FROM la_aap_candidates c WHERE ${CAND_COMPLETE}`
    ).then((r) => [r]);

    // CARD 5 — Assessment Done: candidates whose full 10-parameter assessment is
    // complete (every parameter filled). An existing-but-partial assessment row
    // does NOT count.
    const [[ad]] = await query(
      `SELECT COUNT(*) AS n
         FROM la_candidate_assessments s
         JOIN la_aap_candidates c ON c.id = s.candidate_id
        WHERE ${CAND_COMPLETE} AND ${ALL_PARAMS}`
    ).then((r) => [r]);

    // CARD 1 — Total Completed Assemblies: MLA complete AND all 3 candidates
    // complete. Only these count; NOT every assembly in Master Data.
    const [[completed]] = await query(
      `SELECT COUNT(*) AS n FROM la_assemblies a
        WHERE EXISTS (SELECT 1 FROM la_mla_profiles mp WHERE mp.assembly_id = a.id AND ${MLA_COMPLETE})
          AND (SELECT COUNT(*) FROM la_aap_candidates c WHERE c.assembly_id = a.id AND ${CAND_COMPLETE}) >= 3`
    ).then((r) => [r]);

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
        total_assemblies: Number(a.total) || 0,                  // Master Data count (used elsewhere)
        total_completed_assemblies: Number(completed.n) || 0,    // Card 1: MLA + all 3 candidates complete
        assemblies_with_mla: Number(wm.n) || 0,                  // Card 2
        assemblies_with_candidates: Number(wc.n) || 0,           // Card 3: all 3 candidates complete
        total_candidates: Number(tc.n) || 0,                     // Card 4: valid candidate records
        assessments_completed: Number(ad.n) || 0,                // Card 5: full 10-param assessment
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
