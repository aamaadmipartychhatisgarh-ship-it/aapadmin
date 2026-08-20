import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";

export const dynamic = "force-dynamic";

const partyOrNull = (v) => { const s = String(v ?? "").trim(); return s ? s : null; };
const countOrThrow = (v, label) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) throw `${label} must be a whole number (0 or more).`;
  return n;
};

// PUT /api/leader-assessment/candidates/[cid]/elections/[eid] — edit one election
// record in place (no new row, so editing never duplicates).
export async function PUT(req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { cid, eid } = await params;
    if (!/^\d+$/.test(String(cid)) || !/^\d+$/.test(String(eid))) return NextResponse.json({ message: "Invalid id." }, { status: 400 });
    const [row] = await query("SELECT id FROM la_candidate_elections WHERE id = ? AND candidate_id = ?", [eid, cid]);
    if (!row) return NextResponse.json({ message: "Election record not found." }, { status: 404 });
    const d = await req.json().catch(() => ({}));
    let times_won, total_votes;
    try {
      times_won = countOrThrow(d.times_won, "Times Won");
      total_votes = countOrThrow(d.total_votes, "Total Votes");
    } catch (msg) {
      return NextResponse.json({ message: String(msg) }, { status: 400 });
    }
    await query(
      "UPDATE la_candidate_elections SET times_won=?, party_defeated=?, total_votes=?, party_won=? WHERE id=? AND candidate_id=?",
      [times_won, partyOrNull(d.party_defeated), total_votes, partyOrNull(d.party_won), eid, cid]
    );
    const [saved] = await query("SELECT id, candidate_id, times_won, party_defeated, total_votes, party_won, created_at, updated_at FROM la_candidate_elections WHERE id = ?", [eid]);
    return NextResponse.json({ ok: true, election: saved }, { headers: noStore });
  } catch (e) {
    console.error("[LA] candidate election PUT:", e);
    return NextResponse.json({ message: "Failed to update the election record." }, { status: 500 });
  }
}

// DELETE /api/leader-assessment/candidates/[cid]/elections/[eid] — remove one
// election record (scoped to the candidate so it can't delete another's data).
export async function DELETE(_req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { cid, eid } = await params;
    if (!/^\d+$/.test(String(cid)) || !/^\d+$/.test(String(eid))) return NextResponse.json({ message: "Invalid id." }, { status: 400 });
    const res = await query("DELETE FROM la_candidate_elections WHERE id = ? AND candidate_id = ?", [eid, cid]);
    if (!res.affectedRows) return NextResponse.json({ message: "Election record not found." }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    console.error("[LA] candidate election DELETE:", e);
    return NextResponse.json({ message: "Failed to delete the election record." }, { status: 500 });
  }
}
