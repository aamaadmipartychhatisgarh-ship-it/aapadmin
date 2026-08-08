import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";

export const dynamic = "force-dynamic";

const numOrNull = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
const strOrNull = (v) => { const s = String(v ?? "").trim(); return s ? s : null; };
const dateOrNull = (v) => { const s = String(v ?? "").trim(); return s ? s.slice(0, 10) : null; };

// POST /api/leader-assessment/assemblies/[id]/candidates — add an AAP candidate.
// Capped at 3 active candidates per assembly (for the comparison dashboard).
export async function POST(req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { id } = await params;
    const [asm] = await query("SELECT id FROM la_assemblies WHERE id = ?", [id]);
    if (!asm) return NextResponse.json({ message: "Assembly not found." }, { status: 404 });
    const [{ n }] = await query("SELECT COUNT(*) AS n FROM la_aap_candidates WHERE assembly_id = ?", [id]);
    if (Number(n) >= 3) return NextResponse.json({ message: "An assembly can have at most 3 AAP candidates." }, { status: 400 });
    const d = await req.json().catch(() => ({}));
    const name = strOrNull(d.name);
    if (!name) return NextResponse.json({ message: "Candidate name is required." }, { status: 400 });
    const res = await query(
      `INSERT INTO la_aap_candidates (assembly_id, photo_url, name, phone, address, date_of_birth, caste, net_worth, business, monthly_income)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, strOrNull(d.photo_url), name, strOrNull(d.phone), strOrNull(d.address), dateOrNull(d.date_of_birth),
       strOrNull(d.caste), strOrNull(d.net_worth), strOrNull(d.business), strOrNull(d.monthly_income)]
    );
    return NextResponse.json({ id: res.insertId }, { status: 201, headers: noStore });
  } catch (e) {
    console.error("[LA] candidates POST:", e);
    return NextResponse.json({ message: "Failed to add the candidate." }, { status: 500 });
  }
}
