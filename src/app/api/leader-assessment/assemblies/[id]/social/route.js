import { NextResponse } from "next/server";
import { query, getPool } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";
import { normalizePercentage } from "@/lib/leaderAssessment";

export const dynamic = "force-dynamic";

// PUT /api/leader-assessment/assemblies/[id]/social — replace the assembly's
// social-structure rows (top castes/communities) atomically, ordered by rank.
// Body: { rows: [{ name, percentage }] }. Percentages are validated server-side
// (numeric, 0–100, decimals allowed); named rows are kept, blanks dropped.
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
    let rows;
    try {
      rows = d.rows
        .map((r) => ({ name: String(r?.name ?? "").trim(), percentage: normalizePercentage(r?.percentage) }))
        .filter((r) => r.name);
    } catch (msg) {
      return NextResponse.json({ message: String(msg) }, { status: 400 });
    }
    conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute("DELETE FROM la_social_structure WHERE assembly_id = ?", [id]);
      let rank = 1;
      for (const r of rows) {
        await conn.execute("INSERT INTO la_social_structure (assembly_id, rank_no, name, percentage) VALUES (?, ?, ?, ?)", [id, rank++, r.name, r.percentage]);
      }
      await conn.commit();
    } catch (tx) { try { await conn.rollback(); } catch { /* */ } throw tx; }
    // Return the database-persisted rows so the client shows exactly what saved.
    const saved = await query("SELECT rank_no, name, percentage FROM la_social_structure WHERE assembly_id = ? ORDER BY rank_no ASC", [id]);
    return NextResponse.json({ ok: true, rows: saved }, { headers: noStore });
  } catch (e) {
    console.error("[LA] social PUT:", e);
    return NextResponse.json({ message: "Failed to save the social structure." }, { status: 500 });
  } finally {
    if (conn) { try { conn.release(); } catch { /* */ } }
  }
}
