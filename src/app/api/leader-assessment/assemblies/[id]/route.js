import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";
import { ASSESSMENT_PARAMS, assessmentTotal, ageFromDob, rankCandidates, parseList } from "@/lib/leaderAssessment";

export const dynamic = "force-dynamic";

const numOrNull = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
const strOrNull = (v) => { const s = String(v ?? "").trim(); return s ? s : null; };

// GET /api/leader-assessment/assemblies/[id] — the COMPLETE assembly bundle:
// assembly + MLA (with auto age) + elections + political analysis + social
// structure + AAP candidates (with assessments, auto totals, auto ranking) +
// strategy + a computed completion status. One call drives the whole page, so
// switching assembly swaps every section with zero data leakage.
export async function GET(_req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { id } = await params;
    const [assembly] = await query("SELECT * FROM la_assemblies WHERE id = ?", [id]);
    if (!assembly) return NextResponse.json({ message: "Assembly not found." }, { status: 404 });

    const [mlaRow] = await query("SELECT * FROM la_mla_profiles WHERE assembly_id = ?", [id]);
    const mla = mlaRow ? { ...mlaRow, age: ageFromDob(mlaRow.date_of_birth) } : null;

    const elections = await query(
      "SELECT * FROM la_mla_elections WHERE assembly_id = ? ORDER BY election_year DESC, id DESC", [id]
    );
    const [analysisRow] = await query("SELECT * FROM la_political_analysis WHERE assembly_id = ?", [id]);
    const analysis = analysisRow
      ? { reasons_won: parseList(analysisRow.reasons_won), weaknesses: parseList(analysisRow.weaknesses), strengths: parseList(analysisRow.strengths), updated_at: analysisRow.updated_at }
      : { reasons_won: [], weaknesses: [], strengths: [] };
    const social = await query(
      "SELECT * FROM la_social_structure WHERE assembly_id = ? ORDER BY rank_no ASC, id ASC", [id]
    );

    const candRows = await query(
      `SELECT c.*, s.id AS assessment_id,
              ${ASSESSMENT_PARAMS.map((p) => `s.${p.key}`).join(", ")}
         FROM la_aap_candidates c
         LEFT JOIN la_candidate_assessments s ON s.candidate_id = c.id
        WHERE c.assembly_id = ? ORDER BY c.id ASC`, [id]
    );
    const candidates = candRows.map((c) => {
      const assessment = {};
      let anyScore = false;
      for (const p of ASSESSMENT_PARAMS) { assessment[p.key] = c[p.key]; if (c[p.key] != null) anyScore = true; }
      const total = assessmentTotal(assessment);
      return {
        id: c.id, assembly_id: c.assembly_id, photo_url: c.photo_url, name: c.name, phone: c.phone,
        address: c.address, date_of_birth: c.date_of_birth, age: ageFromDob(c.date_of_birth),
        caste: c.caste, net_worth: c.net_worth, business: c.business, monthly_income: c.monthly_income,
        assessment, total, assessment_done: anyScore, created_at: c.created_at, updated_at: c.updated_at,
      };
    });
    const ranked = rankCandidates(candidates);

    const [strategyRow] = await query("SELECT * FROM la_candidate_strategy WHERE assembly_id = ?", [id]);
    const strategy = strategyRow || { mla_biggest_weakness: "", aap_biggest_strength: "", target_community: "", target_booth: "", main_issue: "" };

    // Completion status (for badges / overview).
    const candDone = candidates.filter((c) => c.assessment_done).length;
    const status = {
      mla: !!(mla && mla.name),
      elections: elections.length > 0,
      candidates_count: candidates.length,
      assessments_done: candDone,
      assessment_complete: candidates.length > 0 && candDone === candidates.length,
      ready: !!(mla && mla.name) && candidates.length > 0 && candDone === candidates.length,
    };

    return NextResponse.json({ assembly, mla, elections, analysis, social, candidates: ranked, strategy, status }, { headers: noStore });
  } catch (e) {
    console.error("[LA] assembly GET:", e);
    return NextResponse.json({ message: "Failed to load the assembly." }, { status: 500 });
  }
}

// PUT — update assembly fields.
export async function PUT(req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { id } = await params;
    const d = await req.json().catch(() => ({}));
    const name = strOrNull(d.name);
    if (!name) return NextResponse.json({ message: "Assembly name is required." }, { status: 400 });
    const res = await query(
      `UPDATE la_assemblies SET name=?, number=?, district=?, lok_sabha=?, total_voters=?, total_polling_stations=?, total_booths=?, election_year=?, population=?, notes=? WHERE id=?`,
      [name, strOrNull(d.number), strOrNull(d.district), strOrNull(d.lok_sabha),
       numOrNull(d.total_voters), numOrNull(d.total_polling_stations), numOrNull(d.total_booths),
       numOrNull(d.election_year), numOrNull(d.population), strOrNull(d.notes), id]
    );
    if (!res.affectedRows) return NextResponse.json({ message: "Assembly not found." }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    console.error("[LA] assembly PUT:", e);
    return NextResponse.json({ message: "Failed to update the assembly." }, { status: 500 });
  }
}

// DELETE — Super Admin only. FK ON DELETE CASCADE removes all child records.
export async function DELETE(_req, { params }) {
  const { error } = await guard({ superAdminOnly: true });
  if (error) return error;
  try {
    const { id } = await params;
    const res = await query("DELETE FROM la_assemblies WHERE id = ?", [id]);
    if (!res.affectedRows) return NextResponse.json({ message: "Assembly not found." }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    console.error("[LA] assembly DELETE:", e);
    return NextResponse.json({ message: "Failed to delete the assembly." }, { status: 500 });
  }
}
