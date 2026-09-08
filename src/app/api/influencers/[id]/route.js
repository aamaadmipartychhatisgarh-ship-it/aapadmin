import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureInfluencerSchema } from "@/lib/influencerSchema";
import { validate, coerce, shape } from "../route";

// Every handler here is Super-Admin ONLY, verified server-side (403 otherwise),
// so influencer detail/update/delete is never reachable by any other role even
// if the client guard is bypassed.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

async function guard() {
  const session = await getServerSession(authOptions);
  if (!session) return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE }) };
  if (!isSuperAdmin(session)) return { error: NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE }) };
  return { session };
}

// GET /api/influencers/[id] → full profile.
export async function GET(_req, { params }) {
  try {
    const { error } = await guard();
    if (error) return error;
    await ensureInfluencerSchema();
    const { id } = await params;
    const iid = Number(id);
    if (!Number.isInteger(iid) || iid <= 0) return NextResponse.json({ message: "Invalid id." }, { status: 400, headers: NO_STORE });
    const [row] = await query("SELECT * FROM influencers WHERE id = ?", [iid]);
    if (!row) return NextResponse.json({ message: "Influencer not found." }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ influencer: shape(row) }, { headers: NO_STORE });
  } catch (err) {
    console.error("[influencer] GET detail error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

// PUT /api/influencers/[id] → update (loads-and-replaces the full record; the
// client always sends the complete form, so no field is silently erased).
export async function PUT(req, { params }) {
  try {
    const { error } = await guard();
    if (error) return error;
    await ensureInfluencerSchema();
    const { id } = await params;
    const iid = Number(id);
    if (!Number.isInteger(iid) || iid <= 0) return NextResponse.json({ message: "Invalid id." }, { status: 400, headers: NO_STORE });
    const [existing] = await query("SELECT id FROM influencers WHERE id = ?", [iid]);
    if (!existing) return NextResponse.json({ message: "Influencer not found." }, { status: 404, headers: NO_STORE });

    const d = await req.json().catch(() => null);
    if (!d || typeof d !== "object") return NextResponse.json({ message: "Invalid request body." }, { status: 400, headers: NO_STORE });
    const verr = await validate(d);
    if (verr) return NextResponse.json({ message: verr }, { status: 400, headers: NO_STORE });

    const v = await coerce(d);
    await query(
      `UPDATE influencers SET
         name=?, phone=?, address=?, assembly_id=?, assembly_name=?, influence_type=?, influence_position=?,
         key_activities=?, political_journey=?, contested_election=?, election_type=?, election_year=?,
         election_constituency=?, election_party=?, election_position=?, election_result=?, election_votes=?,
         election_details=?, org_social_activity=?, economic_status=?, economic_profile=?, potential_rating=?,
         potential_areas=?, expected_contribution=?, potential_remarks=?, status=?, next_action=?, action_remarks=?,
         follow_up_date=?, responsible_person=?
       WHERE id=?`,
      [
        v.name, v.phone, v.address, v.assembly_id, v.assembly_name, v.influence_type, v.influence_position,
        v.key_activities, v.political_journey, v.contested_election, v.election_type, v.election_year,
        v.election_constituency, v.election_party, v.election_position, v.election_result, v.election_votes,
        v.election_details, v.org_social_activity, v.economic_status, v.economic_profile, v.potential_rating,
        v.potential_areas, v.expected_contribution, v.potential_remarks, v.status, v.next_action, v.action_remarks,
        v.follow_up_date, v.responsible_person, iid,
      ]
    );
    const [row] = await query("SELECT * FROM influencers WHERE id = ?", [iid]);
    return NextResponse.json({ influencer: shape(row) }, { headers: NO_STORE });
  } catch (err) {
    console.error("[influencer] PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

// DELETE /api/influencers/[id] → remove (Super-Admin verified server-side).
export async function DELETE(_req, { params }) {
  try {
    const { error } = await guard();
    if (error) return error;
    await ensureInfluencerSchema();
    const { id } = await params;
    const iid = Number(id);
    if (!Number.isInteger(iid) || iid <= 0) return NextResponse.json({ message: "Invalid id." }, { status: 400, headers: NO_STORE });
    const [existing] = await query("SELECT id FROM influencers WHERE id = ?", [iid]);
    if (!existing) return NextResponse.json({ message: "Influencer not found." }, { status: 404, headers: NO_STORE });
    await query("DELETE FROM influencers WHERE id = ?", [iid]);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    console.error("[influencer] DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
