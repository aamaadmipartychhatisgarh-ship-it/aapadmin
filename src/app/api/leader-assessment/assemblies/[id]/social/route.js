import { NextResponse } from "next/server";
import { query, getPool } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";

export const dynamic = "force-dynamic";

const numOrNull = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));

// PUT /api/leader-assessment/assemblies/[id]/social — replace the assembly's
// social-structure rows (top castes/communities) atomically. Body: { rows: [{ name, percentage }] }.
export async function PUT(req, { params }) {
  const { error } = await guard();
  if (error) return error;
  let conn;
  try {
    const { id } = await params;
    const [asm] = await query("SELECT id FROM la_assemblies WHERE id = ?", [id]);
    if (!asm) return NextResponse.json({ message: "Assembly not found." }, { status: 404 });
    const d = await req.json().catch(() => ({}));
    const rows = (Array.isArray(d.rows) ? d.rows : [])
      .map((r) => ({ name: String(r?.name ?? "").trim(), percentage: numOrNull(r?.percentage) }))
      .filter((r) => r.name);
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
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    console.error("[LA] social PUT:", e);
    return NextResponse.json({ message: "Failed to save the social structure." }, { status: 500 });
  } finally {
    if (conn) { try { conn.release(); } catch { /* */ } }
  }
}
