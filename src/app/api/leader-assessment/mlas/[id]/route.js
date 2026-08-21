import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";

export const dynamic = "force-dynamic";

// DELETE /api/leader-assessment/mlas/[id] — remove ONE MLA profile by its unique
// id (la_mla_profiles.id), never by name. Its 10-parameter assessment row is
// removed too (la_mla_assessments has ON DELETE CASCADE on mla_id), so no orphan
// assessment is left behind. Deleting an MLA does NOT touch the assembly or any
// candidate. A missing id → 404 (nothing deleted), so a stale/duplicate click
// can't affect another record.
export async function DELETE(_req, { params }) {
  const { error } = await guard();
  if (error) return error;
  try {
    const { id } = await params;
    if (!/^\d+$/.test(String(id))) return NextResponse.json({ message: "Invalid MLA id." }, { status: 400 });
    let res;
    try {
      res = await query("DELETE FROM la_mla_profiles WHERE id = ?", [id]);
    } catch (e) {
      // A restrictive FK from some other table would block the delete — surface a
      // clear message instead of a silent 500.
      if (e && (e.code === "ER_ROW_IS_REFERENCED_2" || e.errno === 1451)) {
        return NextResponse.json({ message: "This MLA can't be deleted because other records still reference it." }, { status: 409 });
      }
      throw e;
    }
    if (!res.affectedRows) return NextResponse.json({ message: "MLA profile not found." }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    console.error("[LA] mla DELETE:", e);
    return NextResponse.json({ message: "Failed to delete the MLA profile." }, { status: 500 });
  }
}
