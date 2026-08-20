import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";
import { pollingForAssembly, normalizePollingCount } from "@/lib/leaderAssessment";

export const dynamic = "force-dynamic";

// id = assembly_id. The assembly id is the primary relationship for all polling
// data (never the assembly name), so renamed/duplicate names can't mis-map data.
async function loadAssembly(id) {
  const [a] = await query(
    `SELECT a.id, a.location_id, ml.name AS name, dl.name AS district
       FROM la_assemblies a
       JOIN locations ml ON ml.id = a.location_id AND ml.type = 'assembly'
       LEFT JOIN locations dl ON dl.id = ml.parent_id AND dl.type = 'district'
      WHERE a.id = ?`,
    [id]
  );
  return a || null;
}

// GET /api/leader-assessment/polling/[id] — one assembly's polling summary +
// live-counted booths/stations from the master tree (auto_*). has_data:false when
// nothing is stored yet (UI shows "No polling data available").
export async function GET(_req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { id } = await params;
    if (!/^\d+$/.test(String(id))) return NextResponse.json({ message: "Invalid assembly id." }, { status: 400 });
    const assembly = await loadAssembly(id);
    if (!assembly) return NextResponse.json({ message: "Assembly not found." }, { status: 404 });
    const polling = await pollingForAssembly(assembly);
    return NextResponse.json({ assembly: { id: assembly.id, name: assembly.name, district: assembly.district || null }, polling }, { headers: noStore });
  } catch (e) {
    console.error("[LA] polling GET:", e);
    return NextResponse.json({ message: "Failed to load polling data." }, { status: 500 });
  }
}

// PUT /api/leader-assessment/polling/[id] — upsert this assembly's polling summary.
// Body: { total_booths, total_voters, male_voters, female_voters }.
//   • Every value is numeric only, whole number ≥ 0 (negatives/text rejected).
//   • Male + Female must not exceed Total Voters (when the relevant values exist).
//   • UNIQUE assembly_id → exactly one record per assembly (no duplicates).
export async function PUT(req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { id } = await params;
    if (!/^\d+$/.test(String(id))) return NextResponse.json({ message: "Invalid assembly id." }, { status: 400 });
    const assembly = await loadAssembly(id);
    if (!assembly) return NextResponse.json({ message: "Assembly not found." }, { status: 404 });

    const d = await req.json().catch(() => ({}));
    let total_booths, total_voters, male_voters, female_voters;
    try {
      total_booths = normalizePollingCount(d.total_booths, "Total Booths");
      total_voters = normalizePollingCount(d.total_voters, "Total Voters");
      male_voters = normalizePollingCount(d.male_voters, "Male Voters");
      female_voters = normalizePollingCount(d.female_voters, "Female Voters");
    } catch (msg) {
      return NextResponse.json({ message: String(msg) }, { status: 400 });
    }
    // Male + Female cannot exceed Total Voters. Only checked when the totals needed
    // for the comparison are present (a partial entry is allowed).
    const maleFemale = (male_voters || 0) + (female_voters || 0);
    if (total_voters != null && (male_voters != null || female_voters != null) && maleFemale > total_voters) {
      return NextResponse.json({ message: "Male + Female voters cannot exceed Total Voters." }, { status: 400 });
    }

    const [existing] = await query("SELECT id FROM la_polling_data WHERE assembly_id = ?", [id]);
    if (existing) {
      await query(
        `UPDATE la_polling_data SET total_booths=?, total_voters=?, male_voters=?, female_voters=? WHERE assembly_id=?`,
        [total_booths, total_voters, male_voters, female_voters, id]
      );
    } else {
      await query(
        `INSERT INTO la_polling_data (assembly_id, total_booths, total_voters, male_voters, female_voters) VALUES (?, ?, ?, ?, ?)`,
        [id, total_booths, total_voters, male_voters, female_voters]
      );
    }
    // Mirror the headline figures back onto la_assemblies so existing surfaces that
    // read total_voters/total_booths stay consistent with the master.
    await query("UPDATE la_assemblies SET total_voters = ?, total_booths = ? WHERE id = ?", [total_voters, total_booths, id]);

    const polling = await pollingForAssembly(assembly);
    return NextResponse.json({ ok: true, assembly: { id: assembly.id, name: assembly.name, district: assembly.district || null }, polling }, { headers: noStore });
  } catch (e) {
    console.error("[LA] polling PUT:", e);
    return NextResponse.json({ message: "Failed to save polling data." }, { status: 500 });
  }
}
