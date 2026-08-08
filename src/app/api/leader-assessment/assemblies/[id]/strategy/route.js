import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";

export const dynamic = "force-dynamic";

const strOrNull = (v) => { const s = String(v ?? "").trim(); return s ? s : null; };

// PUT /api/leader-assessment/assemblies/[id]/strategy — upsert the editable
// strategic assessment / final-recommendation fields (admin-entered planning
// notes; the ranking itself is computed, not stored here).
export async function PUT(req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { id } = await params;
    const [asm] = await query("SELECT id FROM la_assemblies WHERE id = ?", [id]);
    if (!asm) return NextResponse.json({ message: "Assembly not found." }, { status: 404 });
    const d = await req.json().catch(() => ({}));
    const cols = {
      mla_biggest_weakness: strOrNull(d.mla_biggest_weakness),
      aap_biggest_strength: strOrNull(d.aap_biggest_strength),
      target_community: strOrNull(d.target_community),
      target_booth: strOrNull(d.target_booth),
      main_issue: strOrNull(d.main_issue),
    };
    const keys = Object.keys(cols);
    const [existing] = await query("SELECT id FROM la_candidate_strategy WHERE assembly_id = ?", [id]);
    if (existing) {
      await query(`UPDATE la_candidate_strategy SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE assembly_id=?`, [...keys.map((k) => cols[k]), id]);
    } else {
      await query(`INSERT INTO la_candidate_strategy (assembly_id, ${keys.join(", ")}) VALUES (?, ${keys.map(() => "?").join(", ")})`, [id, ...keys.map((k) => cols[k])]);
    }
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    console.error("[LA] strategy PUT:", e);
    return NextResponse.json({ message: "Failed to save the recommendation." }, { status: 500 });
  }
}
