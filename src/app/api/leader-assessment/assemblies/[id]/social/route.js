import { NextResponse } from "next/server";
import { query, getPool } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";
import { normalizePercentage, normalizeCasteName } from "@/lib/leaderAssessment";

export const dynamic = "force-dynamic";

// PUT /api/leader-assessment/assemblies/[id]/social — replace the assembly's
// social-structure rows (top castes/communities) atomically, ordered by rank.
// Body: { rows: [{ caste_id, name, percentage }] }. Every community MUST come
// from the centralized Caste Master (caste_id); the caste's current master name
// is snapshotted onto the row so historical records keep displaying their value
// even if the caste is later renamed or deactivated. Percentages are validated
// server-side (numeric, 0–100). Duplicate castes within one assembly are rejected.
export async function PUT(req, { params }) {
  const { error } = await guard();
  if (error) return error;
  let conn;
  try {
    const { id } = await params;
    if (!/^\d+$/.test(String(id))) return NextResponse.json({ message: "Invalid assembly id." }, { status: 400 });
    const [asm] = await query("SELECT id FROM la_assemblies WHERE id = ?", [id]);
    if (!asm) return NextResponse.json({ message: "Assembly not found." }, { status: 404 });
    const d = await req.json().catch(() => ({}));
    if (!Array.isArray(d.rows)) return NextResponse.json({ message: "rows must be an array." }, { status: 400 });

    // Resolve every incoming caste against the master. A caste_id is the required
    // relationship; a legacy free-text name (no caste_id) is tolerated for
    // backward compatibility and matched to the master by name when possible.
    let rows;
    try {
      rows = d.rows
        .map((r) => ({
          caste_id: r?.caste_id != null && /^\d+$/.test(String(r.caste_id)) ? Number(r.caste_id) : null,
          name: normalizeCasteName(r?.name),
          percentage: normalizePercentage(r?.percentage),
        }))
        .filter((r) => r.caste_id != null || r.name); // drop fully-blank rows
    } catch (msg) {
      return NextResponse.json({ message: String(msg) }, { status: 400 });
    }

    // Fetch the master rows for all referenced caste_ids in one query, then
    // snapshot the authoritative name onto each row. An unknown caste_id is
    // rejected so the relationship can never dangle.
    const ids = [...new Set(rows.map((r) => r.caste_id).filter((v) => v != null))];
    const masterById = new Map();
    if (ids.length) {
      const found = await query(`SELECT id, name FROM la_castes WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
      for (const c of found) masterById.set(Number(c.id), c.name);
      for (const cid of ids) {
        if (!masterById.has(cid)) return NextResponse.json({ message: "One of the selected castes no longer exists. Refresh and try again." }, { status: 400 });
      }
    }
    for (const r of rows) {
      if (r.caste_id != null) r.name = masterById.get(r.caste_id); // authoritative snapshot
    }
    // No duplicate caste within a single assembly's social profile.
    const seen = new Set();
    for (const r of rows) {
      const key = r.caste_id != null ? `id:${r.caste_id}` : `nm:${r.name.toLowerCase()}`;
      if (seen.has(key)) return NextResponse.json({ message: `Duplicate community "${r.name}" — each caste can be listed only once.` }, { status: 400 });
      seen.add(key);
    }

    conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute("DELETE FROM la_social_structure WHERE assembly_id = ?", [id]);
      let rank = 1;
      for (const r of rows) {
        await conn.execute("INSERT INTO la_social_structure (assembly_id, rank_no, caste_id, name, percentage) VALUES (?, ?, ?, ?, ?)", [id, rank++, r.caste_id, r.name, r.percentage]);
      }
      await conn.commit();
    } catch (tx) { try { await conn.rollback(); } catch { /* */ } throw tx; }
    // Return the database-persisted rows so the client shows exactly what saved.
    const saved = await query("SELECT rank_no, caste_id, name, percentage FROM la_social_structure WHERE assembly_id = ? ORDER BY rank_no ASC", [id]);
    return NextResponse.json({ ok: true, rows: saved }, { headers: noStore });
  } catch (e) {
    console.error("[LA] social PUT:", e);
    return NextResponse.json({ message: "Failed to save the social structure." }, { status: 500 });
  } finally {
    if (conn) { try { conn.release(); } catch { /* */ } }
  }
}
