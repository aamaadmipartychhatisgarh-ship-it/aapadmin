import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";

export const dynamic = "force-dynamic";

const numOrNull = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
const strOrNull = (v) => { const s = String(v ?? "").trim(); return s ? s : null; };

// PUT /api/leader-assessment/elections/[eid] — edit an election record.
export async function PUT(req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { eid } = await params;
    const d = await req.json().catch(() => ({}));
    if (numOrNull(d.election_year) == null) return NextResponse.json({ message: "Election year is required." }, { status: 400 });
    const res = await query(
      `UPDATE la_mla_elections SET election_year=?, election_type=?, party=?, candidate=?, status=?, votes=?, vote_percentage=?, margin=?, result=? WHERE id=?`,
      [numOrNull(d.election_year), strOrNull(d.election_type), strOrNull(d.party), strOrNull(d.candidate),
       strOrNull(d.status), numOrNull(d.votes), numOrNull(d.vote_percentage), numOrNull(d.margin), strOrNull(d.result), eid]
    );
    if (!res.affectedRows) return NextResponse.json({ message: "Election record not found." }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    console.error("[LA] election PUT:", e);
    return NextResponse.json({ message: "Failed to update the election record." }, { status: 500 });
  }
}

// DELETE /api/leader-assessment/elections/[eid] — remove one election record.
export async function DELETE(_req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { eid } = await params;
    const res = await query("DELETE FROM la_mla_elections WHERE id = ?", [eid]);
    if (!res.affectedRows) return NextResponse.json({ message: "Election record not found." }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    console.error("[LA] election DELETE:", e);
    return NextResponse.json({ message: "Failed to delete the election record." }, { status: 500 });
  }
}
