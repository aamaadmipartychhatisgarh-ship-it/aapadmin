import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";
import { normalizeCasteName } from "@/lib/leaderAssessment";

export const dynamic = "force-dynamic";

// GET /api/leader-assessment/castes/[id] — a single caste (with usage count).
export async function GET(_req, { params }) {
  const { error } = await guard({ allowPageKeys: ["caste_master"] });
  if (error) return error;
  try {
    const { id } = await params;
    if (!/^\d+$/.test(String(id))) return NextResponse.json({ message: "Invalid caste id." }, { status: 400 });
    const [row] = await query(
      `SELECT c.id, c.name, c.is_active, c.polling_station_id, ps.name AS polling_station_name,
              c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM la_social_structure s WHERE s.caste_id = c.id) AS usage_count
         FROM la_castes c
         LEFT JOIN locations ps ON ps.id = c.polling_station_id AND ps.type = 'polling_station'
        WHERE c.id = ?`,
      [id]
    );
    if (!row) return NextResponse.json({ message: "Caste not found." }, { status: 404 });
    return NextResponse.json(
      { caste: { ...row, is_active: !!Number(row.is_active), polling_station_id: row.polling_station_id ?? null, polling_station_name: row.polling_station_name || null, usage_count: Number(row.usage_count) || 0 } },
      { headers: noStore }
    );
  } catch (e) {
    console.error("[LA] caste GET:", e);
    return NextResponse.json({ message: "Failed to load the caste." }, { status: 500 });
  }
}

// PUT /api/leader-assessment/castes/[id] — edit a caste's name and/or Status
// (activate / deactivate). Body: { name?, is_active? }.
//   • Renaming is duplicate-checked (case-insensitive) against every OTHER caste.
//   • Deactivating NEVER deletes and NEVER touches historical records — existing
//     social-profile rows keep their caste_id + name and stay valid; the caste
//     simply stops appearing for new selections. Reactivating brings it back.
export async function PUT(req, { params }) {
  const { error } = await guard({ allowPageKeys: ["caste_master"] });
  if (error) return error;
  try {
    const { id } = await params;
    if (!/^\d+$/.test(String(id))) return NextResponse.json({ message: "Invalid caste id." }, { status: 400 });
    const [existing] = await query("SELECT id, name, is_active FROM la_castes WHERE id = ?", [id]);
    if (!existing) return NextResponse.json({ message: "Caste not found." }, { status: 404 });

    const d = await req.json().catch(() => ({}));
    const sets = [];
    const args = [];

    if (d?.name !== undefined) {
      const name = normalizeCasteName(d.name);
      if (!name) return NextResponse.json({ message: "Caste / community name is required." }, { status: 400 });
      if (name.length > 255) return NextResponse.json({ message: "Name is too long (max 255 characters)." }, { status: 400 });
      const [dup] = await query("SELECT id FROM la_castes WHERE name = ? AND id <> ?", [name, id]);
      if (dup) return NextResponse.json({ message: `"${name}" already exists in the caste master.` }, { status: 409 });
      sets.push("name = ?"); args.push(name);
    }
    if (d?.is_active !== undefined) {
      sets.push("is_active = ?"); args.push(d.is_active ? 1 : 0);
    }
    // Polling station (required whenever it's part of the edit). Validate against
    // Master Data so an invalid/non-existing id can never be saved.
    if (d?.polling_station_id !== undefined) {
      if (d.polling_station_id == null || d.polling_station_id === "" || !/^\d+$/.test(String(d.polling_station_id))) {
        return NextResponse.json({ message: "Please select a Polling Station." }, { status: 400 });
      }
      const psId = Number(d.polling_station_id);
      const [ps] = await query("SELECT id FROM locations WHERE id = ? AND type = 'polling_station'", [psId]);
      if (!ps) return NextResponse.json({ message: "The selected Polling Station no longer exists. Refresh and try again." }, { status: 400 });
      sets.push("polling_station_id = ?"); args.push(psId);
    }
    if (!sets.length) return NextResponse.json({ message: "Nothing to update." }, { status: 400 });

    try {
      await query(`UPDATE la_castes SET ${sets.join(", ")} WHERE id = ?`, [...args, id]);
    } catch (e) {
      if (e && (e.code === "ER_DUP_ENTRY" || e.errno === 1062)) {
        return NextResponse.json({ message: "That name already exists in the caste master." }, { status: 409 });
      }
      throw e;
    }
    const [row] = await query(
      `SELECT c.id, c.name, c.is_active, c.polling_station_id, ps.name AS polling_station_name,
              c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM la_social_structure s WHERE s.caste_id = c.id) AS usage_count
         FROM la_castes c
         LEFT JOIN locations ps ON ps.id = c.polling_station_id AND ps.type = 'polling_station'
        WHERE c.id = ?`,
      [id]
    );
    return NextResponse.json(
      { ok: true, caste: { ...row, is_active: !!Number(row.is_active), polling_station_id: row.polling_station_id ?? null, polling_station_name: row.polling_station_name || null, usage_count: Number(row.usage_count) || 0 } },
      { headers: noStore }
    );
  } catch (e) {
    console.error("[LA] caste PUT:", e);
    return NextResponse.json({ message: "Failed to update the caste." }, { status: 500 });
  }
}

// DELETE /api/leader-assessment/castes/[id] — permanently remove a caste from the
// master. Historical social-profile rows that referenced it keep their recorded
// NAME (the FK is ON DELETE SET NULL, so only the caste_id link is cleared) — so
// deleting never corrupts past records. Deactivate instead if you only want to
// hide it from new selections.
export async function DELETE(_req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { id } = await params;
    if (!/^\d+$/.test(String(id))) return NextResponse.json({ message: "Invalid caste id." }, { status: 400 });
    const res = await query("DELETE FROM la_castes WHERE id = ?", [id]);
    if (!res.affectedRows) return NextResponse.json({ message: "Caste not found." }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    console.error("[LA] caste DELETE:", e);
    return NextResponse.json({ message: "Failed to delete the caste." }, { status: 500 });
  }
}
