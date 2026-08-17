import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";
import { ASSESSMENT_PARAMS, assessmentTotal } from "@/lib/leaderAssessment";

export const dynamic = "force-dynamic";

// GET /api/leader-assessment/overview — module dashboard stats. All derived from
// the DB; empty module → clean zeros (not fake data).
export async function GET() {
  const { error } = await guard();
  if (error) return error;
  try {
    // Total Assembly = exactly the set of assemblies the module lists, which is
    // mirrored from the Master Data (locations type='assembly'): the count of
    // master-linked la_assemblies rows when the master is populated, else the
    // legacy rows. Matching the list's own rule guarantees the card and the list
    // never disagree, and it tracks Master Data automatically.
    const linkedCnt = await query("SELECT COUNT(*) AS n FROM la_assemblies WHERE location_id IS NOT NULL");
    const a = Number(linkedCnt[0]?.n || 0) > 0
      ? { total: Number(linkedCnt[0].n) }
      : (await query("SELECT COUNT(*) AS total FROM la_assemblies"))[0] || { total: 0 };
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
    const scored = rows.map((r) => ({ id: r.id, name: r.name, assembly_name: r.assembly_name, total: assessmentTotal(r) }));
    const avg = scored.length ? Math.round((scored.reduce((s, r) => s + r.total, 0) / scored.length) * 10) / 10 : 0;
    const top = [...scored].sort((x, y) => y.total - x.total).slice(0, 5);

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
    }, { headers: noStore });
  } catch (e) {
    console.error("[LA] overview GET:", e);
    return NextResponse.json({ message: "Failed to load the overview." }, { status: 500 });
  }
}
