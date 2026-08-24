import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";
import { normalizeCasteName } from "@/lib/leaderAssessment";

export const dynamic = "force-dynamic";

// GET /api/leader-assessment/castes — the centralized Caste / Community master.
//   ?search=<text>  case-insensitive name filter
//   ?active=1       only active castes (used by the selection dropdowns so
//                   deactivated castes never appear for NEW selections). Omitted
//                   → every caste (active + inactive) for the management screen.
// Each caste carries: id (Unique ID), name, is_active (Status), created_at,
// updated_at, and a live usage count (how many social-profile rows reference it).
export async function GET(req) {
  const { error } = await guard({ allowPageKeys: ["caste_master"] });
  if (error) return error;
  try {
    const { searchParams } = new URL(req.url);
    const search = normalizeCasteName(searchParams.get("search") || "");
    const activeOnly = ["1", "true", "yes"].includes(String(searchParams.get("active") || "").toLowerCase());

    const where = [];
    const args = [];
    if (activeOnly) where.push("c.is_active = 1");
    if (search) { where.push("c.name LIKE ?"); args.push(`%${search}%`); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query(
      `SELECT c.id, c.name, c.is_active, c.polling_station_id, ps.name AS polling_station_name,
              c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM la_social_structure s WHERE s.caste_id = c.id) AS usage_count
         FROM la_castes c
         LEFT JOIN locations ps ON ps.id = c.polling_station_id AND ps.type = 'polling_station'
         ${whereSql}
        ORDER BY c.is_active DESC, c.name ASC`,
      args
    );
    const castes = rows.map((r) => ({
      id: r.id,
      name: r.name,
      is_active: !!Number(r.is_active),
      polling_station_id: r.polling_station_id ?? null,
      polling_station_name: r.polling_station_name || null,
      usage_count: Number(r.usage_count) || 0,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
    return NextResponse.json({ castes }, { headers: noStore });
  } catch (e) {
    console.error("[LA] castes GET:", e);
    return NextResponse.json({ message: "Failed to load the caste master." }, { status: 500 });
  }
}

// POST /api/leader-assessment/castes — add a new caste/community to the master.
// Name is required and must be UNIQUE (case-insensitive) — a duplicate is
// rejected with a clear message instead of creating a second record. New castes
// are active by default.
export async function POST(req) {
  const { error } = await guard({ allowPageKeys: ["caste_master"] });
  if (error) return error;
  try {
    const d = await req.json().catch(() => ({}));
    const name = normalizeCasteName(d?.name);
    if (!name) return NextResponse.json({ message: "Caste / community name is required." }, { status: 400 });
    if (name.length > 255) return NextResponse.json({ message: "Name is too long (max 255 characters)." }, { status: 400 });

    // Duplicate guard (case-insensitive). The UNIQUE key is the hard backstop;
    // this explicit check returns a friendlier message before we hit it.
    const [dup] = await query("SELECT id, name, is_active FROM la_castes WHERE name = ?", [name]);
    if (dup) {
      return NextResponse.json(
        { message: `"${dup.name}" already exists in the caste master${Number(dup.is_active) ? "" : " (currently deactivated)"}.` },
        { status: 409 }
      );
    }
    const isActive = d?.is_active === false ? 0 : 1;
    let res;
    try {
      res = await query("INSERT INTO la_castes (name, is_active) VALUES (?, ?)", [name, isActive]);
    } catch (e) {
      if (e && (e.code === "ER_DUP_ENTRY" || e.errno === 1062)) {
        return NextResponse.json({ message: `"${name}" already exists in the caste master.` }, { status: 409 });
      }
      throw e;
    }
    const [row] = await query("SELECT id, name, is_active, created_at, updated_at FROM la_castes WHERE id = ?", [res.insertId]);
    return NextResponse.json(
      { ok: true, caste: { ...row, is_active: !!Number(row.is_active), usage_count: 0 } },
      { headers: noStore }
    );
  } catch (e) {
    console.error("[LA] castes POST:", e);
    return NextResponse.json({ message: "Failed to add the caste." }, { status: 500 });
  }
}
