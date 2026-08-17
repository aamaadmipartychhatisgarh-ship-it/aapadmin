import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";
import { ASSESSMENT_PARAMS, assessmentTotal, ageFromDob, rankCandidates, parseList, assemblyElectorate } from "@/lib/leaderAssessment";

export const dynamic = "force-dynamic";

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
    // Pull the assembly and its authoritative district name straight from the
    // Master Data (`locations`) via district_id, so the district/assembly
    // relationship shown on every tab (incl. Election History) always reflects
    // Master Data — the stored text is only a fallback.
    const [assembly] = await query(
      `SELECT a.*, dl.name AS master_district_name
         FROM la_assemblies a
         LEFT JOIN locations dl ON dl.id = a.district_id AND dl.type = 'district'
        WHERE a.id = ?`,
      [id]
    );
    if (!assembly) return NextResponse.json({ message: "Assembly not found." }, { status: 404 });
    if (assembly.master_district_name) assembly.district = assembly.master_district_name;
    delete assembly.master_district_name;
    // Overwrite the electorate figures with authoritative, live-computed values
    // (voters / polling stations / booths) so the header never shows stale or
    // empty stored columns.
    Object.assign(assembly, await assemblyElectorate(assembly));

    const [mlaRow] = await query("SELECT * FROM la_mla_profiles WHERE assembly_id = ?", [id]);
    let mla = null;
    if (mlaRow) {
      const [asmt] = await query(
        `SELECT ${ASSESSMENT_PARAMS.map((p) => `s.${p.key}`).join(", ")} FROM la_mla_assessments s WHERE s.mla_id = ?`,
        [mlaRow.id]
      );
      const assessment = {};
      let assessmentDone = false;
      for (const p of ASSESSMENT_PARAMS) { assessment[p.key] = asmt?.[p.key] ?? null; if (asmt?.[p.key] != null) assessmentDone = true; }
      mla = { ...mlaRow, age: ageFromDob(mlaRow.date_of_birth), assessment, total: assessmentTotal(assessment), assessment_done: assessmentDone };
    }

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
        education: c.education, political_experience: c.political_experience,
        organization_experience: c.organization_experience, previous_elections: c.previous_elections,
        current_position: c.current_position,
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

// This route is read-only: the in-module Assemblies CRUD section was removed, so
// assemblies are no longer edited/deleted here (they come from the Administration
// master + the module seed). The detail tabs still write through the /mla,
// /elections, /candidates, /analysis, /social and /strategy sub-routes.
