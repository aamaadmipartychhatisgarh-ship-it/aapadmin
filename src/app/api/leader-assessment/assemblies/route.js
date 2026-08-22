import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";
import { assessmentTotal, assemblyComplete, syncAssemblies } from "@/lib/leaderAssessment";
import { workersByDistrict } from "@/lib/workerCounts";

export const dynamic = "force-dynamic";

// GET /api/leader-assessment/assemblies?search=&district=
// Assembly list enriched with MLA name, candidate count and a top candidate.
// Master Data (locations type='assembly') is the single source of truth: only
// assemblies that CURRENTLY exist in master are listed (via the INNER JOIN), the
// name/district come from master, and the mirror is refreshed on each request so
// additions/edits/removals in master show up immediately.
export async function GET(req) {
  const { session, error } = await guard();
  if (error) return error;
  try {
    await syncAssemblies();
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim();
    const district = searchParams.get("district")?.trim();
    const where = [];
    const params = [];
    if (search) { where.push("(ml.name LIKE ? OR a.number LIKE ? OR dl.name LIKE ? OR a.lok_sabha LIKE ?)"); params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
    if (district) { where.push("dl.name = ?"); params.push(district); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    // INNER JOIN to the master assembly row: an la_assemblies row whose master
    // assembly no longer exists (or was never linked) is excluded automatically,
    // so the list can never show a stale/duplicate/non-master assembly. The
    // authoritative name + parent district are read straight from master.
    const rows = await query(
      `SELECT a.*, ml.name AS master_name, dl.name AS master_district, dl.id AS master_district_id,
              m.name AS mla_name, m.photo_url AS mla_photo_url,
              (SELECT COUNT(*) FROM la_aap_candidates c WHERE c.assembly_id = a.id) AS candidate_count
         FROM la_assemblies a
         JOIN locations ml ON ml.id = a.location_id AND ml.type = 'assembly'
         LEFT JOIN locations dl ON dl.id = ml.parent_id AND dl.type = 'district'
         LEFT JOIN la_mla_profiles m ON m.assembly_id = a.id
         ${whereSql}
         ORDER BY ml.name ASC`,
      params
    );
    // Compute each assembly's top candidate + score without an N+1 storm.
    const ids = rows.map((r) => r.id);
    let cands = [];
    if (ids.length) {
      cands = await query(
        `SELECT c.id, c.assembly_id, c.name, c.photo_url, s.*
           FROM la_aap_candidates c
           LEFT JOIN la_candidate_assessments s ON s.candidate_id = c.id
          WHERE c.assembly_id IN (${ids.map(() => "?").join(",")})`,
        ids
      );
    }
    const topByAsm = {};
    const candsByAsm = {};
    for (const c of cands) {
      (candsByAsm[c.assembly_id] ||= []).push(c);
      const total = assessmentTotal(c);
      const cur = topByAsm[c.assembly_id];
      if (!cur || total > cur.total) topByAsm[c.assembly_id] = { name: c.name, total, photo_url: c.photo_url || null };
    }
    // Live worker count per assembly: resolved from real users/workers keyed by
    // the assembly's district_id (never stored, so it auto-updates as workers
    // are added / removed / reassigned).
    const workerMap = await workersByDistrict();
    const assemblies = rows.map((r) => {
      const { master_name, master_district, master_district_id, ...rest } = r;
      // Live worker count keyed by the authoritative master district id (FK),
      // falling back to the mirrored district_id.
      const districtId = master_district_id != null ? master_district_id : r.district_id;
      return {
        ...rest,
        // Authoritative name + district straight from Master Data.
        name: master_name || r.name,
        district: master_district || r.district,
        district_id: districtId,
        candidate_count: Number(r.candidate_count) || 0,
        required_workers: r.required_workers != null ? Number(r.required_workers) : null,
        worker_count: districtId != null ? (workerMap.get(districtId) || 0) : 0,
        mla_photo_url: r.mla_photo_url || null,
        top_candidate: topByAsm[r.id]?.name || null,
        top_candidate_photo_url: topByAsm[r.id]?.photo_url || null,
        top_score: topByAsm[r.id]?.total ?? null,
        // THE assembly completion status (same rule everywhere): all its
        // candidates have a complete 10-parameter assessment. Computed live from
        // the candidates, so it recalculates whenever an assessment or the
        // candidate set changes.
        completed: assemblyComplete(candsByAsm[r.id] || []),
      };
    });
    return NextResponse.json({ assemblies }, { headers: noStore });
  } catch (e) {
    console.error("[LA] assemblies GET:", e);
    return NextResponse.json({ message: "Failed to load assemblies." }, { status: 500 });
  }
}

// Assemblies are managed by the Administration master + the module's seed, not
// created/edited here — the in-module Assemblies CRUD section was removed, so
// this route is read-only (no POST). PUT/DELETE were likewise removed from the
// [id] route; the detail tabs still write via the /mla, /elections, etc. sub-routes.
