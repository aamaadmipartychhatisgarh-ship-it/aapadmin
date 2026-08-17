import { NextResponse } from "next/server";
import { query, getPool } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";

export const dynamic = "force-dynamic";

// Trim a list of free-text lines, drop blanks, cap length.
const cleanList = (v, max) => (Array.isArray(v) ? v : []).map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, max);

// PUT /api/leader-assessment/assemblies/[id]/analysis — upsert political
// analysis: up to 3 reasons-won, 5 strengths, 10 weaknesses (all admin-entered,
// never generated). Stored normalized in la_political_points (one row per point,
// FK to the assembly) AND mirrored to la_political_analysis for compatibility.
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
    const reasons = cleanList(d.reasons_won, 3);
    const strengths = cleanList(d.strengths, 5);
    const weaknesses = cleanList(d.weaknesses, 10);

    conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      // Normalized rows: replace this assembly's points per kind.
      await conn.execute("DELETE FROM la_political_points WHERE assembly_id = ?", [id]);
      const insertPoints = async (kind, list) => {
        let sort = 1;
        for (const content of list) {
          await conn.execute("INSERT INTO la_political_points (assembly_id, kind, sort_order, content) VALUES (?, ?, ?, ?)", [id, kind, sort++, content]);
        }
      };
      await insertPoints("reason", reasons);
      await insertPoints("strength", strengths);
      await insertPoints("weakness", weaknesses);
      // Compatibility mirror.
      const [existing] = await conn.execute("SELECT id FROM la_political_analysis WHERE assembly_id = ?", [id]);
      const rJson = JSON.stringify(reasons), sJson = JSON.stringify(strengths), wJson = JSON.stringify(weaknesses);
      if (existing[0]) {
        await conn.execute("UPDATE la_political_analysis SET reasons_won=?, weaknesses=?, strengths=? WHERE assembly_id=?", [rJson, wJson, sJson, id]);
      } else {
        await conn.execute("INSERT INTO la_political_analysis (assembly_id, reasons_won, weaknesses, strengths) VALUES (?, ?, ?, ?)", [id, rJson, wJson, sJson]);
      }
      await conn.commit();
    } catch (tx) { try { await conn.rollback(); } catch { /* */ } throw tx; }
    return NextResponse.json({ ok: true, reasons_won: reasons, strengths, weaknesses }, { headers: noStore });
  } catch (e) {
    console.error("[LA] analysis PUT:", e);
    return NextResponse.json({ message: "Failed to save the political analysis." }, { status: 500 });
  } finally {
    if (conn) { try { conn.release(); } catch { /* */ } }
  }
}
