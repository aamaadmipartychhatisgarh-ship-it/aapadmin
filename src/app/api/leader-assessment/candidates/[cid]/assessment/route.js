import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";
import { ASSESSMENT_PARAMS, normalizeScore, assessmentTotal } from "@/lib/leaderAssessment";

export const dynamic = "force-dynamic";

// PUT /api/leader-assessment/candidates/[cid]/assessment — upsert the 100-point
// assessment. Each of the 10 scores is validated 0–10 (integers only). The
// TOTAL is never accepted from the client — it is always recomputed. Updates the
// existing assessment in place (no duplicate rows).
export async function PUT(req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { cid } = await params;
    const [cand] = await query("SELECT id FROM la_aap_candidates WHERE id = ?", [cid]);
    if (!cand) return NextResponse.json({ message: "Candidate not found." }, { status: 404 });
    const d = await req.json().catch(() => ({}));
    const scores = {};
    try {
      for (const p of ASSESSMENT_PARAMS) scores[p.key] = normalizeScore(d[p.key]);
    } catch (msg) {
      return NextResponse.json({ message: String(msg) }, { status: 400 });
    }
    const keys = ASSESSMENT_PARAMS.map((p) => p.key);
    const [existing] = await query("SELECT id FROM la_candidate_assessments WHERE candidate_id = ?", [cid]);
    if (existing) {
      await query(`UPDATE la_candidate_assessments SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE candidate_id=?`, [...keys.map((k) => scores[k]), cid]);
    } else {
      await query(`INSERT INTO la_candidate_assessments (candidate_id, ${keys.join(", ")}) VALUES (?, ${keys.map(() => "?").join(", ")})`, [cid, ...keys.map((k) => scores[k])]);
    }
    return NextResponse.json({ ok: true, total: assessmentTotal(scores) }, { headers: noStore });
  } catch (e) {
    console.error("[LA] assessment PUT:", e);
    return NextResponse.json({ message: "Failed to save the assessment." }, { status: 500 });
  }
}
