import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";

export const dynamic = "force-dynamic";

// Party fields: trim; blank/undefined/null → null (never the string "undefined").
const partyOrNull = (v) => { const s = String(v ?? "").trim(); return s ? s : null; };
// Numeric counts: blank → null; otherwise a whole number ≥ 0 (negatives/text rejected).
const countOrThrow = (v, label) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) throw `${label} must be a whole number (0 or more).`;
  return n;
};

// GET /api/leader-assessment/candidates/[cid]/elections — this candidate's
// previous election history (oldest first). Empty array when there's none.
export async function GET(_req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { cid } = await params;
    if (!/^\d+$/.test(String(cid))) return NextResponse.json({ message: "Invalid candidate id." }, { status: 400 });
    const rows = await query(
      "SELECT id, candidate_id, times_won, party_defeated, total_votes, party_won, created_at, updated_at FROM la_candidate_elections WHERE candidate_id = ? ORDER BY id ASC",
      [cid]
    );
    return NextResponse.json({ elections: rows }, { headers: noStore });
  } catch (e) {
    console.error("[LA] candidate elections GET:", e);
    return NextResponse.json({ message: "Failed to load election history." }, { status: 500 });
  }
}

// POST /api/leader-assessment/candidates/[cid]/elections — add one election
// record for this candidate (linked by candidate_id). Each call inserts exactly
// one row, so repeated submissions never silently duplicate an existing record.
export async function POST(req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { cid } = await params;
    if (!/^\d+$/.test(String(cid))) return NextResponse.json({ message: "Invalid candidate id." }, { status: 400 });
    const [cand] = await query("SELECT id FROM la_aap_candidates WHERE id = ?", [cid]);
    if (!cand) return NextResponse.json({ message: "Candidate not found." }, { status: 404 });
    const d = await req.json().catch(() => ({}));
    let times_won, total_votes;
    try {
      times_won = countOrThrow(d.times_won, "Times Won");
      total_votes = countOrThrow(d.total_votes, "Total Votes");
    } catch (msg) {
      return NextResponse.json({ message: String(msg) }, { status: 400 });
    }
    const res = await query(
      "INSERT INTO la_candidate_elections (candidate_id, times_won, party_defeated, total_votes, party_won) VALUES (?, ?, ?, ?, ?)",
      [cid, times_won, partyOrNull(d.party_defeated), total_votes, partyOrNull(d.party_won)]
    );
    const [row] = await query("SELECT id, candidate_id, times_won, party_defeated, total_votes, party_won, created_at, updated_at FROM la_candidate_elections WHERE id = ?", [res.insertId]);
    return NextResponse.json({ ok: true, election: row }, { status: 201, headers: noStore });
  } catch (e) {
    console.error("[LA] candidate elections POST:", e);
    return NextResponse.json({ message: "Failed to add the election record." }, { status: 500 });
  }
}
