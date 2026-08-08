import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";

export const dynamic = "force-dynamic";

// Trim a list of free-text lines, drop blanks, cap length. Stored as JSON.
const cleanList = (v, max) => (Array.isArray(v) ? v : []).map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, max);

// PUT /api/leader-assessment/assemblies/[id]/analysis — upsert political
// analysis: up to 3 reasons-won, 10 weaknesses, 5 strengths (all admin-entered,
// never generated).
export async function PUT(req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { id } = await params;
    const [asm] = await query("SELECT id FROM la_assemblies WHERE id = ?", [id]);
    if (!asm) return NextResponse.json({ message: "Assembly not found." }, { status: 404 });
    const d = await req.json().catch(() => ({}));
    const reasons = JSON.stringify(cleanList(d.reasons_won, 3));
    const weaknesses = JSON.stringify(cleanList(d.weaknesses, 10));
    const strengths = JSON.stringify(cleanList(d.strengths, 5));
    const [existing] = await query("SELECT id FROM la_political_analysis WHERE assembly_id = ?", [id]);
    if (existing) {
      await query("UPDATE la_political_analysis SET reasons_won=?, weaknesses=?, strengths=? WHERE assembly_id=?", [reasons, weaknesses, strengths, id]);
    } else {
      await query("INSERT INTO la_political_analysis (assembly_id, reasons_won, weaknesses, strengths) VALUES (?, ?, ?, ?)", [id, reasons, weaknesses, strengths]);
    }
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    console.error("[LA] analysis PUT:", e);
    return NextResponse.json({ message: "Failed to save the political analysis." }, { status: 500 });
  }
}
