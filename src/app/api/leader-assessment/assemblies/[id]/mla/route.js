import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";

export const dynamic = "force-dynamic";

const numOrNull = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
const strOrNull = (v) => { const s = String(v ?? "").trim(); return s ? s : null; };
const dateOrNull = (v) => { const s = String(v ?? "").trim(); return s ? s.slice(0, 10) : null; };

// PUT /api/leader-assessment/assemblies/[id]/mla — upsert the single MLA
// profile for this assembly (one row per assembly). Age is NEVER stored — only
// date_of_birth; age is derived on read. Existing election history is untouched.
export async function PUT(req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { id } = await params;
    const [asm] = await query("SELECT id FROM la_assemblies WHERE id = ?", [id]);
    if (!asm) return NextResponse.json({ message: "Assembly not found." }, { status: 404 });
    const d = await req.json().catch(() => ({}));
    const cols = {
      photo_url: strOrNull(d.photo_url),
      name: strOrNull(d.name),
      phone: strOrNull(d.phone),
      address: strOrNull(d.address),
      date_of_birth: dateOrNull(d.date_of_birth),
      caste: strOrNull(d.caste),
      party: strOrNull(d.party),
      net_worth: strOrNull(d.net_worth),
      criminal_cases: numOrNull(d.criminal_cases),
      times_won: numOrNull(d.times_won),
      times_contested: numOrNull(d.times_contested),
      largest_winning_margin: numOrNull(d.largest_winning_margin),
      previous_winning_margin: numOrNull(d.previous_winning_margin),
      party_won_from: strOrNull(d.party_won_from),
      party_defeated: strOrNull(d.party_defeated),
    };
    const keys = Object.keys(cols);
    const [existing] = await query("SELECT id FROM la_mla_profiles WHERE assembly_id = ?", [id]);
    if (existing) {
      await query(`UPDATE la_mla_profiles SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE assembly_id=?`, [...keys.map((k) => cols[k]), id]);
    } else {
      await query(`INSERT INTO la_mla_profiles (assembly_id, ${keys.join(", ")}) VALUES (?, ${keys.map(() => "?").join(", ")})`, [id, ...keys.map((k) => cols[k])]);
    }
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    console.error("[LA] mla PUT:", e);
    return NextResponse.json({ message: "Failed to save the MLA profile." }, { status: 500 });
  }
}
