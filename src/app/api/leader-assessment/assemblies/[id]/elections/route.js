import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";

export const dynamic = "force-dynamic";

const numOrNull = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
const strOrNull = (v) => { const s = String(v ?? "").trim(); return s ? s : null; };

// POST /api/leader-assessment/assemblies/[id]/elections — add an election record.
export async function POST(req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { id } = await params;
    const [asm] = await query("SELECT id FROM la_assemblies WHERE id = ?", [id]);
    if (!asm) return NextResponse.json({ message: "Assembly not found." }, { status: 404 });
    const d = await req.json().catch(() => ({}));
    if (numOrNull(d.election_year) == null) return NextResponse.json({ message: "Election year is required." }, { status: 400 });
    const res = await query(
      `INSERT INTO la_mla_elections (assembly_id, election_year, election_type, party, candidate, status, votes, vote_percentage, margin, result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, numOrNull(d.election_year), strOrNull(d.election_type), strOrNull(d.party), strOrNull(d.candidate),
       strOrNull(d.status), numOrNull(d.votes), numOrNull(d.vote_percentage), numOrNull(d.margin), strOrNull(d.result)]
    );
    return NextResponse.json({ id: res.insertId }, { status: 201, headers: noStore });
  } catch (e) {
    console.error("[LA] elections POST:", e);
    return NextResponse.json({ message: "Failed to add the election record." }, { status: 500 });
  }
}
