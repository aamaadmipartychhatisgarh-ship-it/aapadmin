import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRegistrationAccess, NO_STORE } from "@/lib/registrationGuard";
import { ELECTION_TYPES, newLinkToken } from "@/lib/registrationSchema";

// Election drives — the "Election Details" block every link and registration
// hangs off. One drive is normally `active` at a time; closing a drive
// immediately stops every worker link under it from accepting submissions.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET() {
  try {
    const { error } = await requireRegistrationAccess();
    if (error) return error;
    const campaigns = await query(
      `SELECT c.*,
              (SELECT COUNT(*) FROM reg_workers w WHERE w.campaign_id = c.id) AS worker_count,
              (SELECT COUNT(*) FROM reg_people p WHERE p.campaign_id = c.id AND p.status = 'active') AS registration_count
         FROM reg_campaigns c
        ORDER BY c.status = 'active' DESC, c.created_at DESC`
    );
    return NextResponse.json({ campaigns }, { headers: NO_STORE });
  } catch (e) {
    console.error("[registration] campaigns GET error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(req) {
  try {
    const { session, error } = await requireRegistrationAccess();
    if (error) return error;
    const d = await req.json().catch(() => null);
    if (!d || typeof d !== "object") return NextResponse.json({ message: "Invalid request." }, { status: 400, headers: NO_STORE });

    const name = String(d.name || "").trim();
    if (!name) return NextResponse.json({ message: "Election name is required." }, { status: 400, headers: NO_STORE });

    const electionType = ELECTION_TYPES.includes(d.election_type) ? d.election_type : "assembly";
    const clip = (v, n) => { const s = String(v ?? "").trim(); return s ? s.slice(0, n) : null; };
    // The constituency may be picked from master data (locations) or typed free —
    // the id is only stored when it resolves to a real assembly/lok_sabha row.
    let constituencyId = null;
    let constituency = clip(d.constituency, 160);
    if (d.constituency_id && /^\d+$/.test(String(d.constituency_id))) {
      const [loc] = await query(`SELECT id, name FROM locations WHERE id = ? AND type IN ('assembly','lok_sabha')`, [d.constituency_id]);
      if (loc) { constituencyId = loc.id; constituency = loc.name; }
    }

    // /join always opens the ACTIVE drive, so only one may be active at a time —
    // creating a live drive closes whatever was running, and the shared link
    // simply starts pointing at the new one.
    const status = d.status === "closed" ? "closed" : "active";
    if (status === "active") await query(`UPDATE reg_campaigns SET status = 'closed' WHERE status = 'active'`);

    const res = await query(
      `INSERT INTO reg_campaigns (name, election_type, constituency, constituency_id, ward_number, election_year, public_token, status, created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [name.slice(0, 160), electionType, constituency, constituencyId,
       clip(d.ward_number, 60), clip(d.election_year, 9), newLinkToken(),
       status, session?.user?.id || null]
    );
    const [campaign] = await query(`SELECT * FROM reg_campaigns WHERE id = ?`, [res.insertId]);
    return NextResponse.json({ campaign }, { status: 201, headers: NO_STORE });
  } catch (e) {
    console.error("[registration] campaigns POST error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
