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
    // Only the fields actually present in the payload are written, so saving one
    // Election Issue never overwrites the other two (§1.7) and a partial update
    // never blanks an unspecified column.
    const ALLOWED = [
      "mla_biggest_weakness", "aap_biggest_strength", "target_community", "target_booth",
      "main_issue", "election_issue_1", "election_issue_2", "election_issue_3",
    ];
    const cols = {};
    for (const k of ALLOWED) if (k in d) cols[k] = strOrNull(d[k]);

    // Priority candidates (Candidate 1/2/3) — stored by ID. Each provided id must
    // be a real candidate OF THIS ASSEMBLY (never another assembly's), else it's
    // cleared. Duplicate ids across the three slots are rejected so the same
    // candidate can't occupy two slots.
    const candKeys = ["candidate_1_id", "candidate_2_id", "candidate_3_id"];
    const provided = candKeys.filter((k) => k in d);
    if (provided.length) {
      const ids = provided.map((k) => (d[k] === "" || d[k] == null ? null : Number(d[k])));
      const nonNull = ids.filter((v) => v != null);
      if (nonNull.some((v) => !Number.isInteger(v) || v <= 0)) {
        return NextResponse.json({ message: "Invalid candidate selection." }, { status: 400 });
      }
      if (new Set(nonNull).size !== nonNull.length) {
        return NextResponse.json({ message: "The same candidate cannot be chosen for more than one slot." }, { status: 400 });
      }
      // Validate every provided id belongs to this assembly.
      if (nonNull.length) {
        const rows = await query(
          `SELECT id FROM la_aap_candidates WHERE assembly_id = ? AND id IN (${nonNull.map(() => "?").join(",")})`,
          [id, ...nonNull]
        );
        const valid = new Set(rows.map((r) => Number(r.id)));
        if (nonNull.some((v) => !valid.has(v))) {
          return NextResponse.json({ message: "A selected candidate does not belong to this assembly." }, { status: 400 });
        }
      }
      provided.forEach((k, i) => { cols[k] = ids[i]; });
    }
    const keys = Object.keys(cols);
    if (!keys.length) return NextResponse.json({ ok: true }, { headers: noStore });
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
