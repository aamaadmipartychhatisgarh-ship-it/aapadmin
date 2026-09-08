import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";
import {
  ensureInfluencerSchema, normalizeStatus, normalizeRating,
  INFLUENCE_TYPES, POTENTIAL_RATINGS, STATUSES, NEXT_ACTIONS, ECONOMIC_STATUSES,
} from "@/lib/influencerSchema";

// The Influencer module is Super-Admin ONLY. Every handler re-verifies the role
// server-side (never trusts the hidden nav / client guard) and returns 403 for
// anyone else, so no influencer data ever leaves the server for a non-super user.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

const META = {
  influenceTypes: INFLUENCE_TYPES,
  potentialRatings: POTENTIAL_RATINGS,
  statuses: STATUSES,
  nextActions: NEXT_ACTIONS,
  economicStatuses: ECONOMIC_STATUSES,
};

// Whitelisted sort columns → never interpolate a raw client string into SQL.
const SORT_COLS = {
  newest: "created_at DESC",
  oldest: "created_at ASC",
  name_az: "name ASC",
  name_za: "name DESC",
  updated: "updated_at DESC",
};

// Normalize the multi-entry key-activities list to a clean JSON array string.
function packActivities(v) {
  let arr = [];
  if (Array.isArray(v)) arr = v;
  else if (typeof v === "string" && v.trim()) {
    try { const p = JSON.parse(v); if (Array.isArray(p)) arr = p; else arr = [v]; }
    catch { arr = v.split("\n"); }
  }
  const clean = arr.map((s) => String(s || "").trim()).filter(Boolean);
  return clean.length ? JSON.stringify(clean) : null;
}

// GET /api/influencers               → paginated list (search + filters)
// GET /api/influencers?meta=1         → option sets for the form/filters
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (!isSuperAdmin(session)) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    await ensureInfluencerSchema();

    const { searchParams } = new URL(req.url);
    if (searchParams.get("meta") === "1") {
      return NextResponse.json({ meta: META }, { headers: NO_STORE });
    }

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10) || 20));
    const offset = (page - 1) * pageSize;

    const where = [];
    const params = [];
    const search = (searchParams.get("search") || "").trim();
    if (search) {
      where.push("(name LIKE ? OR phone LIKE ? OR assembly_name LIKE ? OR responsible_person LIKE ?)");
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    const status = (searchParams.get("status") || "").trim();
    if (status) { where.push("status = ?"); params.push(status); }
    const assemblyId = (searchParams.get("assembly_id") || "").trim();
    if (assemblyId) { where.push("assembly_id = ?"); params.push(assemblyId); }
    const rating = (searchParams.get("potential_rating") || "").trim();
    if (rating) { where.push("potential_rating = ?"); params.push(rating); }
    const nextAction = (searchParams.get("next_action") || "").trim();
    if (nextAction) { where.push("next_action = ?"); params.push(nextAction); }
    const influenceType = (searchParams.get("influence_type") || "").trim();
    if (influenceType) { where.push("influence_type = ?"); params.push(influenceType); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const orderBy = SORT_COLS[searchParams.get("sort")] || SORT_COLS.newest;

    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM influencers ${whereSql}`, params);
    // pageSize/offset are validated integers (parseInt + clamp above), so they
    // are inlined — mysql2's prepared execute() rejects LIMIT/OFFSET placeholders.
    const rows = await query(
      `SELECT * FROM influencers ${whereSql} ORDER BY ${orderBy} LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    const influencers = rows.map(shape);

    return NextResponse.json(
      { influencers, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), meta: META },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error("[influencer] GET list error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

// POST /api/influencers → create.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (!isSuperAdmin(session)) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    await ensureInfluencerSchema();

    const d = await req.json().catch(() => null);
    if (!d || typeof d !== "object") return NextResponse.json({ message: "Invalid request body." }, { status: 400, headers: NO_STORE });

    const err = await validate(d);
    if (err) return NextResponse.json({ message: err }, { status: 400, headers: NO_STORE });

    const v = await coerce(d);
    const res = await query(
      `INSERT INTO influencers
        (name, phone, address, assembly_id, assembly_name, influence_type, influence_position,
         key_activities, political_journey, contested_election, election_type, election_year,
         election_constituency, election_party, election_position, election_result, election_votes,
         election_details, org_social_activity, economic_status, economic_profile, potential_rating,
         potential_areas, expected_contribution, potential_remarks, status, next_action, action_remarks,
         follow_up_date, responsible_person, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        v.name, v.phone, v.address, v.assembly_id, v.assembly_name, v.influence_type, v.influence_position,
        v.key_activities, v.political_journey, v.contested_election, v.election_type, v.election_year,
        v.election_constituency, v.election_party, v.election_position, v.election_result, v.election_votes,
        v.election_details, v.org_social_activity, v.economic_status, v.economic_profile, v.potential_rating,
        v.potential_areas, v.expected_contribution, v.potential_remarks, v.status, v.next_action, v.action_remarks,
        v.follow_up_date, v.responsible_person, session.user.id || null,
      ]
    );
    const [row] = await query("SELECT * FROM influencers WHERE id = ?", [res.insertId]);
    return NextResponse.json({ influencer: shape(row) }, { status: 201, headers: NO_STORE });
  } catch (err) {
    console.error("[influencer] POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

// --- shared validation / coercion (also used by [id] PUT) ------------------

export async function validate(d) {
  const name = String(d.name ?? "").trim();
  if (!name) return "Name is required.";
  if (name.length > 150) return "Name is too long.";
  const phone = String(d.phone ?? "").trim();
  if (phone) {
    const digits = phone.replace(/[^0-9]/g, "");
    if (digits.length < 7 || digits.length > 15) return "Enter a valid phone number.";
  }
  // Assembly, when provided, must be a real assembly in the master data.
  if (d.assembly_id != null && String(d.assembly_id).trim() !== "") {
    const rows = await query("SELECT id, name FROM locations WHERE id = ? AND type = 'assembly'", [d.assembly_id]);
    if (!rows.length) return "Select a valid assembly.";
  }
  return null;
}

export async function coerce(d) {
  let assembly_id = null, assembly_name = null;
  if (d.assembly_id != null && String(d.assembly_id).trim() !== "") {
    const rows = await query("SELECT id, name FROM locations WHERE id = ? AND type = 'assembly'", [d.assembly_id]);
    if (rows.length) { assembly_id = rows[0].id; assembly_name = rows[0].name; }
  }
  const s = (x, max) => {
    const v = String(x ?? "").trim();
    if (!v) return null;
    return max ? v.slice(0, max) : v;
  };
  const contested = d.contested_election === true || d.contested_election === 1 ||
    d.contested_election === "1" || d.contested_election === "yes" || d.contested_election === "Yes";
  let follow = s(d.follow_up_date);
  if (follow) follow = String(follow).slice(0, 10);
  return {
    name: String(d.name).trim().slice(0, 150),
    phone: s(d.phone, 30),
    address: s(d.address),
    assembly_id, assembly_name,
    influence_type: s(d.influence_type, 80),
    influence_position: s(d.influence_position),
    key_activities: packActivities(d.key_activities),
    political_journey: s(d.political_journey),
    contested_election: contested ? 1 : 0,
    election_type: contested ? s(d.election_type, 120) : null,
    election_year: contested ? s(d.election_year, 12) : null,
    election_constituency: contested ? s(d.election_constituency, 160) : null,
    election_party: contested ? s(d.election_party, 120) : null,
    election_position: contested ? s(d.election_position, 120) : null,
    election_result: contested ? s(d.election_result, 120) : null,
    election_votes: contested ? s(d.election_votes, 60) : null,
    election_details: contested ? s(d.election_details) : null,
    org_social_activity: s(d.org_social_activity),
    economic_status: s(d.economic_status, 80),
    economic_profile: s(d.economic_profile),
    potential_rating: normalizeRating(d.potential_rating),
    potential_areas: s(d.potential_areas),
    expected_contribution: s(d.expected_contribution),
    potential_remarks: s(d.potential_remarks),
    status: normalizeStatus(d.status),
    next_action: s(d.next_action, 80),
    action_remarks: s(d.action_remarks),
    follow_up_date: follow,
    responsible_person: s(d.responsible_person, 160),
  };
}

// Shape a DB row for the API — decode key_activities JSON to an array.
export function shape(row) {
  if (!row) return row;
  let activities = [];
  if (row.key_activities) {
    try { const p = JSON.parse(row.key_activities); if (Array.isArray(p)) activities = p; }
    catch { activities = String(row.key_activities).split("\n").filter(Boolean); }
  }
  return { ...row, key_activities: activities };
}
