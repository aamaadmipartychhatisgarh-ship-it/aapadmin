import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";
import { ASSESSMENT_PARAMS, normalizeScore, assessmentTotal, assessmentComplete } from "@/lib/leaderAssessment";

export const dynamic = "force-dynamic";

// PUT /api/leader-assessment/mlas/[id]/assessment — upsert the sitting MLA's
// 10-parameter assessment (id = la_mla_profiles.id). Each of the 10 scores is
// validated 0–10 (integers only). The TOTAL is never accepted from the client —
// it is always recomputed. Updates the existing row in place (no duplicates),
// and touches only this MLA's assessment.
export async function PUT(req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { id } = await params;
    if (!/^\d+$/.test(String(id))) return NextResponse.json({ message: "Invalid MLA id." }, { status: 400 });
    // A valid MLA id implies a valid assembly (FK); confirm both here so an
    // assessment can never attach to a missing MLA/assembly.
    const [mla] = await query(
      `SELECT mp.id FROM la_mla_profiles mp JOIN la_assemblies a ON a.id = mp.assembly_id WHERE mp.id = ?`,
      [id]
    );
    if (!mla) return NextResponse.json({ message: "MLA not found." }, { status: 404 });
    const d = await req.json().catch(() => ({}));
    const scores = {};
    try {
      for (const p of ASSESSMENT_PARAMS) scores[p.key] = normalizeScore(d[p.key]);
    } catch (msg) {
      return NextResponse.json({ message: String(msg) }, { status: 400 });
    }
    const keys = ASSESSMENT_PARAMS.map((p) => p.key);
    const [existing] = await query("SELECT id FROM la_mla_assessments WHERE mla_id = ?", [id]);
    if (existing) {
      await query(`UPDATE la_mla_assessments SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE mla_id=?`, [...keys.map((k) => scores[k]), id]);
    } else {
      await query(`INSERT INTO la_mla_assessments (mla_id, ${keys.join(", ")}) VALUES (?, ${keys.map(() => "?").join(", ")})`, [id, ...keys.map((k) => scores[k])]);
    }
    // Return the persisted scores + server-computed total AND completion status,
    // recalculated from the saved values (COMPLETED only when all 10 are valid).
    const [saved] = await query(`SELECT ${keys.join(", ")} FROM la_mla_assessments WHERE mla_id = ?`, [id]);
    const row = saved || {};
    const completedParameters = ASSESSMENT_PARAMS.filter((p) => Number(row[p.key]) > 0).length;
    const done = assessmentComplete(row);
    return NextResponse.json({
      ok: true,
      mlaId: Number(id),
      assessment: row,
      total: assessmentTotal(row),
      completedParameters,
      totalParameters: ASSESSMENT_PARAMS.length,
      assessment_done: done,
      status: done ? "COMPLETED" : "INCOMPLETE",
    }, { headers: noStore });
  } catch (e) {
    console.error("[LA] mla assessment PUT:", e);
    return NextResponse.json({ message: "Failed to save the assessment." }, { status: 500 });
  }
}
