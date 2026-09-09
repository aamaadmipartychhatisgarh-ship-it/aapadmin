import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRegistrationAccess, NO_STORE } from "@/lib/registrationGuard";
import { ELECTION_TYPES } from "@/lib/registrationSchema";

// Edit or remove one election drive. Deletion is Super-Admin-only and refuses
// while any registration still hangs off the drive — collected field data is
// never destroyed as a side effect of tidying up a campaign list.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function PATCH(req, { params }) {
  try {
    const { error } = await requireRegistrationAccess();
    if (error) return error;
    const { id } = await params;
    const d = await req.json().catch(() => null);
    if (!d || typeof d !== "object") return NextResponse.json({ message: "Invalid request." }, { status: 400, headers: NO_STORE });

    const sets = [];
    const vals = [];
    const clip = (v, n) => { const s = String(v ?? "").trim(); return s ? s.slice(0, n) : null; };
    if (d.name !== undefined) {
      const name = String(d.name || "").trim();
      if (!name) return NextResponse.json({ message: "Election name is required." }, { status: 400, headers: NO_STORE });
      sets.push("name = ?"); vals.push(name.slice(0, 160));
    }
    if (d.election_type !== undefined && ELECTION_TYPES.includes(d.election_type)) { sets.push("election_type = ?"); vals.push(d.election_type); }
    if (d.constituency !== undefined) { sets.push("constituency = ?, constituency_id = NULL"); vals.push(clip(d.constituency, 160)); }
    if (d.constituency_id !== undefined && /^\d+$/.test(String(d.constituency_id || ""))) {
      const [loc] = await query(`SELECT id, name FROM locations WHERE id = ? AND type IN ('assembly','lok_sabha')`, [d.constituency_id]);
      if (loc) { sets.push("constituency = ?, constituency_id = ?"); vals.push(loc.name, loc.id); }
    }
    if (d.ward_number !== undefined) { sets.push("ward_number = ?"); vals.push(clip(d.ward_number, 60)); }
    if (d.election_year !== undefined) { sets.push("election_year = ?"); vals.push(clip(d.election_year, 9)); }
    if (d.status !== undefined && ["active", "closed"].includes(d.status)) { sets.push("status = ?"); vals.push(d.status); }
    if (!sets.length) return NextResponse.json({ message: "Nothing to update." }, { status: 400, headers: NO_STORE });

    // /join opens the ACTIVE drive, so exactly one may be active at a time.
    // Opening this one therefore closes the others — otherwise the link's
    // destination would depend on a tiebreak nobody can see.
    if (d.status === "active") {
      await query(`UPDATE reg_campaigns SET status = 'closed' WHERE id <> ? AND status = 'active'`, [id]);
    }
    await query(`UPDATE reg_campaigns SET ${sets.join(", ")} WHERE id = ?`, [...vals, id]);
    const [campaign] = await query(`SELECT * FROM reg_campaigns WHERE id = ?`, [id]);
    if (!campaign) return NextResponse.json({ message: "Not found." }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ campaign }, { headers: NO_STORE });
  } catch (e) {
    console.error("[registration] campaign PATCH error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

export async function DELETE(req, { params }) {
  try {
    const { error } = await requireRegistrationAccess({ superAdminOnly: true });
    if (error) return error;
    const { id } = await params;
    const [{ people }] = await query(`SELECT COUNT(*) AS people FROM reg_people WHERE campaign_id = ?`, [id]);
    if (Number(people) > 0) {
      return NextResponse.json(
        { message: `This drive already holds ${people} registration${Number(people) === 1 ? "" : "s"}. Close it instead of deleting.` },
        { status: 409, headers: NO_STORE }
      );
    }
    await query(`DELETE FROM reg_workers WHERE campaign_id = ?`, [id]);
    await query(`DELETE FROM reg_campaigns WHERE id = ?`, [id]);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    console.error("[registration] campaign DELETE error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
