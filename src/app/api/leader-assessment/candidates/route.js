import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";
import { ASSESSMENT_PARAMS, assessmentTotal } from "@/lib/leaderAssessment";

export const dynamic = "force-dynamic";

// GET /api/leader-assessment/candidates?assembly_id=
// The COMPLETE, database-driven AAP candidate list across every assembly
// (optionally narrowed to one). Each row carries its assembly + the authoritative
// district (resolved from the master-linked la_assemblies -> locations) and its
// live assessment score/status — nothing here is computed from unrelated frontend
// data, and the assembly association comes straight from Master Data.
export async function GET(req) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { searchParams } = new URL(req.url);
    const assemblyId = searchParams.get("assembly_id");
    const where = [];
    const params = [];
    if (assemblyId) { where.push("c.assembly_id = ?"); params.push(assemblyId); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await query(
      `SELECT c.id, c.assembly_id, c.name, c.photo_url, c.phone, c.caste,
              c.current_position, c.date_of_birth, c.created_at,
              a.name AS assembly_name,
              COALESCE(dl.name, a.district) AS district,
              s.id AS assessment_id, ${ASSESSMENT_PARAMS.map((p) => `s.${p.key}`).join(", ")}
         FROM la_aap_candidates c
         JOIN la_assemblies a ON a.id = c.assembly_id
         LEFT JOIN locations dl ON dl.id = a.district_id AND dl.type = 'district'
         LEFT JOIN la_candidate_assessments s ON s.candidate_id = c.id
         ${whereSql}
         ORDER BY a.name ASC, c.name ASC`,
      params
    );
    const candidates = rows.map((r) => {
      const assessment = {};
      let anyScore = false;
      for (const p of ASSESSMENT_PARAMS) { assessment[p.key] = r[p.key]; if (r[p.key] != null) anyScore = true; }
      return {
        id: r.id,
        assembly_id: r.assembly_id,
        assembly_name: r.assembly_name || null,
        district: r.district || null,
        name: r.name,
        photo_url: r.photo_url,
        phone: r.phone,
        caste: r.caste,
        current_position: r.current_position,
        date_of_birth: r.date_of_birth,
        assessment,
        total: assessmentTotal(assessment),
        assessment_done: anyScore,
      };
    });
    return NextResponse.json({ candidates }, { headers: noStore });
  } catch (e) {
    console.error("[LA] candidates list GET:", e);
    return NextResponse.json({ message: "Failed to load candidates." }, { status: 500 });
  }
}
