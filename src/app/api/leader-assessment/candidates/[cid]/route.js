import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";

export const dynamic = "force-dynamic";

const strOrNull = (v) => { const s = String(v ?? "").trim(); return s ? s : null; };
const dateOrNull = (v) => { const s = String(v ?? "").trim(); return s ? s.slice(0, 10) : null; };
const numOrNull = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));

// PUT /api/leader-assessment/candidates/[cid] — edit a candidate. Age is derived
// from date_of_birth (never stored). The assembly the candidate belongs to can
// be changed (assembly_id, chosen from Master Data); moving to another assembly
// re-checks the 3-per-assembly cap so a reassignment can't overfill it.
export async function PUT(req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { cid } = await params;
    const d = await req.json().catch(() => ({}));
    const name = strOrNull(d.name);
    if (!name) return NextResponse.json({ message: "Candidate name is required." }, { status: 400 });

    const [cur] = await query("SELECT assembly_id FROM la_aap_candidates WHERE id = ?", [cid]);
    if (!cur) return NextResponse.json({ message: "Candidate not found." }, { status: 404 });

    // Optional reassignment to a different (master-linked) assembly.
    const newAsmId = numOrNull(d.assembly_id);
    if (newAsmId != null && Number(cur.assembly_id) !== newAsmId) {
      const [asm] = await query("SELECT id FROM la_assemblies WHERE id = ?", [newAsmId]);
      if (!asm) return NextResponse.json({ message: "Assembly not found." }, { status: 404 });
      const [{ n }] = await query("SELECT COUNT(*) AS n FROM la_aap_candidates WHERE assembly_id = ?", [newAsmId]);
      if (Number(n) >= 3) return NextResponse.json({ message: "An assembly can have at most 3 AAP candidates." }, { status: 400 });
    }

    const cols = ["photo_url=?", "name=?", "phone=?", "address=?", "date_of_birth=?", "caste=?", "net_worth=?", "business=?", "monthly_income=?", "education=?", "political_experience=?", "organization_experience=?", "previous_elections=?", "current_position=?"];
    const vals = [strOrNull(d.photo_url), name, strOrNull(d.phone), strOrNull(d.address), dateOrNull(d.date_of_birth),
      strOrNull(d.caste), strOrNull(d.net_worth), strOrNull(d.business), strOrNull(d.monthly_income),
      strOrNull(d.education), strOrNull(d.political_experience), strOrNull(d.organization_experience), strOrNull(d.previous_elections), strOrNull(d.current_position)];
    if (newAsmId != null) { cols.push("assembly_id=?"); vals.push(newAsmId); }
    vals.push(cid);
    const res = await query(`UPDATE la_aap_candidates SET ${cols.join(", ")} WHERE id=?`, vals);
    if (!res.affectedRows) return NextResponse.json({ message: "Candidate not found." }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    console.error("[LA] candidate PUT:", e);
    return NextResponse.json({ message: "Failed to update the candidate." }, { status: 500 });
  }
}

// DELETE /api/leader-assessment/candidates/[cid] — remove a candidate (its
// assessment cascades away).
export async function DELETE(_req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { cid } = await params;
    const res = await query("DELETE FROM la_aap_candidates WHERE id = ?", [cid]);
    if (!res.affectedRows) return NextResponse.json({ message: "Candidate not found." }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    console.error("[LA] candidate DELETE:", e);
    return NextResponse.json({ message: "Failed to delete the candidate." }, { status: 500 });
  }
}
