import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";
import { assessmentTotal } from "@/lib/leaderAssessment";
import { workersByDistrict } from "@/lib/workerCounts";

export const dynamic = "force-dynamic";

const numOrNull = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
const strOrNull = (v) => { const s = String(v ?? "").trim(); return s ? s : null; };

// GET /api/leader-assessment/assemblies?search=&district=
// Assembly list enriched with MLA name, candidate count and a top candidate.
export async function GET(req) {
  const { session, error } = await guard();
  if (error) return error;
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim();
    const district = searchParams.get("district")?.trim();
    const where = [];
    const params = [];
    if (search) { where.push("(a.name LIKE ? OR a.number LIKE ? OR a.district LIKE ? OR a.lok_sabha LIKE ?)"); params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
    if (district) { where.push("a.district = ?"); params.push(district); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await query(
      `SELECT a.*, m.name AS mla_name,
              (SELECT COUNT(*) FROM la_aap_candidates c WHERE c.assembly_id = a.id) AS candidate_count
         FROM la_assemblies a
         LEFT JOIN la_mla_profiles m ON m.assembly_id = a.id
         ${whereSql}
         ORDER BY a.name ASC`,
      params
    );
    // Compute each assembly's top candidate + score without an N+1 storm.
    const ids = rows.map((r) => r.id);
    let cands = [];
    if (ids.length) {
      cands = await query(
        `SELECT c.id, c.assembly_id, c.name, s.*
           FROM la_aap_candidates c
           LEFT JOIN la_candidate_assessments s ON s.candidate_id = c.id
          WHERE c.assembly_id IN (${ids.map(() => "?").join(",")})`,
        ids
      );
    }
    const topByAsm = {};
    for (const c of cands) {
      const total = assessmentTotal(c);
      const cur = topByAsm[c.assembly_id];
      if (!cur || total > cur.total) topByAsm[c.assembly_id] = { name: c.name, total };
    }
    // Live worker count per assembly: resolved from real users/workers keyed by
    // the assembly's district_id (never stored, so it auto-updates as workers
    // are added / removed / reassigned).
    const workerMap = await workersByDistrict();
    const assemblies = rows.map((r) => ({
      ...r,
      candidate_count: Number(r.candidate_count) || 0,
      required_workers: r.required_workers != null ? Number(r.required_workers) : null,
      worker_count: r.district_id != null ? (workerMap.get(r.district_id) || 0) : 0,
      top_candidate: topByAsm[r.id]?.name || null,
      top_score: topByAsm[r.id]?.total ?? null,
    }));
    return NextResponse.json({ assemblies }, { headers: noStore });
  } catch (e) {
    console.error("[LA] assemblies GET:", e);
    return NextResponse.json({ message: "Failed to load assemblies." }, { status: 500 });
  }
}

// POST /api/leader-assessment/assemblies — create an assembly.
export async function POST(req) {
  const { session, error } = await guard();
  if (error) return error;
  try {
    const d = await req.json().catch(() => ({}));
    const name = strOrNull(d.name);
    if (!name) return NextResponse.json({ message: "Assembly name is required." }, { status: 400 });
    const res = await query(
      `INSERT INTO la_assemblies (name, number, district, lok_sabha, total_voters, total_polling_stations, total_booths, election_year, population, notes, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, strOrNull(d.number), strOrNull(d.district), strOrNull(d.lok_sabha),
       numOrNull(d.total_voters), numOrNull(d.total_polling_stations), numOrNull(d.total_booths),
       numOrNull(d.election_year), numOrNull(d.population), strOrNull(d.notes), session.user.id]
    );
    return NextResponse.json({ id: res.insertId }, { status: 201, headers: noStore });
  } catch (e) {
    console.error("[LA] assemblies POST:", e);
    return NextResponse.json({ message: "Failed to create the assembly." }, { status: 500 });
  }
}
