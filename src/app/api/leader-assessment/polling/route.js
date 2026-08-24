import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";
import { syncAssemblies } from "@/lib/leaderAssessment";

export const dynamic = "force-dynamic";

// GET /api/leader-assessment/polling — assembly-wise polling summary for the whole
// Polling Station Master. One row per master assembly (INNER JOIN to locations, so
// only assemblies that currently exist in Master Data appear), LEFT JOINed to its
// polling record by assembly_id (the primary relationship — never by name). An
// assembly with no polling record comes back with null figures + has_data:false so
// the UI can show "No polling data available" instead of a fake 0.
export async function GET(req) {
  const { error } = await guard({ allowPageKeys: ["polling_master"] });
  if (error) return error;
  try {
    await syncAssemblies();
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim();
    const where = [];
    const params = [];
    if (search) { where.push("(ml.name LIKE ? OR dl.name LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    // District / Lok Sabha / Zone are DERIVED from the authoritative Master Data
    // location tree (assembly → district → lok_sabha → zone), never stored on the
    // voter record — so the selected assembly uniquely determines them.
    const rows = await query(
      `SELECT a.id AS assembly_id, ml.name AS assembly_name,
              dl.name AS district, lsl.name AS lok_sabha, zl.name AS zone,
              p.id AS polling_id, p.total_booths, p.total_voters, p.male_voters,
              p.female_voters, p.updated_at
         FROM la_assemblies a
         JOIN locations ml ON ml.id = a.location_id AND ml.type = 'assembly'
         LEFT JOIN locations dl ON dl.id = ml.parent_id AND dl.type = 'district'
         LEFT JOIN locations lsl ON lsl.id = dl.parent_id AND lsl.type = 'lok_sabha'
         LEFT JOIN locations zl ON zl.id = lsl.parent_id AND zl.type = 'zone'
         LEFT JOIN la_polling_data p ON p.assembly_id = a.id
         ${whereSql}
        ORDER BY ml.name ASC`,
      params
    );
    const items = rows.map((r) => ({
      assembly_id: r.assembly_id,
      assembly_name: r.assembly_name,
      district: r.district || null,
      lok_sabha: r.lok_sabha || null,
      zone: r.zone || null,
      has_data: r.polling_id != null,
      total_booths: r.total_booths ?? null,
      total_voters: r.total_voters ?? null,
      male_voters: r.male_voters ?? null,
      female_voters: r.female_voters ?? null,
      updated_at: r.updated_at ?? null,
    }));
    return NextResponse.json({ items }, { headers: noStore });
  } catch (e) {
    console.error("[LA] polling list GET:", e);
    return NextResponse.json({ message: "Failed to load polling data." }, { status: 500 });
  }
}
