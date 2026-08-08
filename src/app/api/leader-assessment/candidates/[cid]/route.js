import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";

export const dynamic = "force-dynamic";

const strOrNull = (v) => { const s = String(v ?? "").trim(); return s ? s : null; };
const dateOrNull = (v) => { const s = String(v ?? "").trim(); return s ? s.slice(0, 10) : null; };

// PUT /api/leader-assessment/candidates/[cid] — edit a candidate. Age is derived
// from date_of_birth (never stored).
export async function PUT(req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { cid } = await params;
    const d = await req.json().catch(() => ({}));
    const name = strOrNull(d.name);
    if (!name) return NextResponse.json({ message: "Candidate name is required." }, { status: 400 });
    const res = await query(
      `UPDATE la_aap_candidates SET photo_url=?, name=?, phone=?, address=?, date_of_birth=?, caste=?, net_worth=?, business=?, monthly_income=?, education=?, political_experience=?, organization_experience=?, previous_elections=?, current_position=? WHERE id=?`,
      [strOrNull(d.photo_url), name, strOrNull(d.phone), strOrNull(d.address), dateOrNull(d.date_of_birth),
       strOrNull(d.caste), strOrNull(d.net_worth), strOrNull(d.business), strOrNull(d.monthly_income),
       strOrNull(d.education), strOrNull(d.political_experience), strOrNull(d.organization_experience), strOrNull(d.previous_elections), strOrNull(d.current_position), cid]
    );
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
