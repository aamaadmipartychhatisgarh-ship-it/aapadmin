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
