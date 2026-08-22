import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";

export const dynamic = "force-dynamic";

const numOrNull = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
const strOrNull = (v) => { const s = String(v ?? "").trim(); return s ? s : null; };
const dateOrNull = (v) => { const s = String(v ?? "").trim(); return s ? s.slice(0, 10) : null; };
// Vote counts: blank → null (never NaN/undefined); otherwise a whole number ≥ 0.
// Invalid text is rejected so it can never be stored as a vote count.
const votesOrThrow = (v, label) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) throw `${label} must be a whole number of votes (0 or more).`;
  return n;
};

// PUT /api/leader-assessment/assemblies/[id]/mla — upsert the single MLA
// profile for this assembly (one row per assembly). Age is NEVER stored — only
// date_of_birth; age is derived on read. Existing election history is untouched.
export async function PUT(req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { id } = await params;
    if (!/^\d+$/.test(String(id))) return NextResponse.json({ message: "Invalid assembly id." }, { status: 400 });
    const [asm] = await query("SELECT id FROM la_assemblies WHERE id = ?", [id]);
    if (!asm) return NextResponse.json({ message: "Assembly not found." }, { status: 404 });
    const d = await req.json().catch(() => ({}));
    if (!strOrNull(d.name)) return NextResponse.json({ message: "MLA name is required." }, { status: 400 });
    let competitor1_votes, competitor2_votes, competitor3_votes, mla_votes;
    try {
      mla_votes = votesOrThrow(d.mla_votes, "MLA Total Votes");
      competitor1_votes = votesOrThrow(d.competitor1_votes, "Total Votes 1");
      competitor2_votes = votesOrThrow(d.competitor2_votes, "Total Votes 2");
      competitor3_votes = votesOrThrow(d.competitor3_votes, "Total Votes 3");
    } catch (msg) {
      return NextResponse.json({ message: String(msg) }, { status: 400 });
    }
    // Winning Margin is DERIVED, never taken from the client, and is ALWAYS
    // (MLA votes − Competitor 1 votes). Competitor 2 NEVER affects it. Stays null
    // until both MLA votes and Competitor 1 votes are present.
    const competitor_margin = mla_votes != null && competitor1_votes != null
      ? mla_votes - competitor1_votes
      : null;
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
      competitor1_name: strOrNull(d.competitor1_name),
      competitor1_party: strOrNull(d.competitor1_party),
      competitor1_votes,
      competitor2_name: strOrNull(d.competitor2_name),
      competitor2_party: strOrNull(d.competitor2_party),
      competitor2_votes,
      competitor3_name: strOrNull(d.competitor3_name),
      competitor3_party: strOrNull(d.competitor3_party),
      competitor3_votes,
      competitor_margin,
      mla_votes,
    };
    const keys = Object.keys(cols);
    const [existing] = await query("SELECT id FROM la_mla_profiles WHERE assembly_id = ?", [id]);
    if (existing) {
      // Data-integrity guard (§5.4): a partial update that does NOT include
      // photo_url must never wipe an already-stored MLA photo. Only overwrite
      // the photo when the client actually sent the field; otherwise leave the
      // existing value in place.
      const upKeys = d.photo_url === undefined ? keys.filter((k) => k !== "photo_url") : keys;
      await query(`UPDATE la_mla_profiles SET ${upKeys.map((k) => `${k}=?`).join(", ")} WHERE assembly_id=?`, [...upKeys.map((k) => cols[k]), id]);
    } else {
      await query(`INSERT INTO la_mla_profiles (assembly_id, ${keys.join(", ")}) VALUES (?, ${keys.map(() => "?").join(", ")})`, [id, ...keys.map((k) => cols[k])]);
    }
    // Return the database-persisted MLA row (one per assembly — no duplicates).
    const [mla] = await query("SELECT * FROM la_mla_profiles WHERE assembly_id = ?", [id]);
    return NextResponse.json({ ok: true, mla }, { headers: noStore });
  } catch (e) {
    console.error("[LA] mla PUT:", e);
    return NextResponse.json({ message: "Failed to save the MLA profile." }, { status: 500 });
  }
}
