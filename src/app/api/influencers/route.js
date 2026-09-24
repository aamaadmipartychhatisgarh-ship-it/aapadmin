import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { userCanAccessPageKey } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import {
  ensureInfluencerSchema, normalizeStatus, normalizeRating, resolveAssemblyHierarchy,
  POTENTIAL_RATINGS, STATUSES, NEXT_ACTIONS, ECONOMIC_STATUSES,
} from "@/lib/influencerSchema";

// Access to the Influencer module is governed by the "influencers" page key
// (Super Admin + Supervisor by baseline, plus anyone granted it in Page Access).
// Every handler re-verifies it server-side via userCanAccessPageKey (never trusts
// the nav / client guard) and returns 403 for anyone without it, so no influencer
// data ever leaves the server for an unauthorized user.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

const META = {
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
    if (!(await userCanAccessPageKey(session, "influencers"))) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    await ensureInfluencerSchema();

    const { searchParams } = new URL(req.url);
    if (searchParams.get("meta") === "1") {
      return NextResponse.json({ meta: META }, { headers: NO_STORE });
    }
    // Live dashboard: overall status totals + per-assembly Total/Joined/Pending/
    // Cancelled, computed from the actual records. Every master assembly is listed
    // (LEFT JOIN), including those with zero influencers (§2, §12, §16, §17, §25).
    if (searchParams.get("stats") === "1") {
      const [totals] = await query(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(status = 'Joined'), 0) AS joined,
                COALESCE(SUM(status = 'Pending'), 0) AS pending,
                COALESCE(SUM(status = 'Cancelled'), 0) AS cancelled
           FROM influencers`
      );
      const assemblies = await query(
        `SELECT a.id AS assembly_id, a.name AS assembly_name,
                COUNT(i.id) AS total,
                COALESCE(SUM(i.status = 'Joined'), 0) AS joined,
                COALESCE(SUM(i.status = 'Pending'), 0) AS pending,
                COALESCE(SUM(i.status = 'Cancelled'), 0) AS cancelled
           FROM locations a
           LEFT JOIN influencers i ON i.assembly_id = a.id
          WHERE a.type = 'assembly'
          GROUP BY a.id, a.name
          ORDER BY a.name ASC`
      );
      const num = (r) => ({ ...r, total: Number(r.total) || 0, joined: Number(r.joined) || 0, pending: Number(r.pending) || 0, cancelled: Number(r.cancelled) || 0 });
      return NextResponse.json(
        { totals: num(totals || {}), assemblies: assemblies.map(num) },
        { headers: NO_STORE }
      );
    }
    // Live location resolver for the form: given an assembly, return the mapped
    // District / Lok Sabha / Zone from master data (DB-driven, never hardcoded).
    const locOf = searchParams.get("location_of");
    if (locOf) {
      const location = await resolveAssemblyHierarchy(locOf);
      return NextResponse.json({ location }, { headers: NO_STORE });
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
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const orderBy = SORT_COLS[searchParams.get("sort")] || SORT_COLS.newest;

    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM influencers ${whereSql}`, params);
    // pageSize/offset are validated integers (parseInt + clamp above), so they
    // are inlined — mysql2's prepared execute() rejects LIMIT/OFFSET placeholders.
    const rows = await query(
      `SELECT influencers.*,
              (SELECT username FROM users u WHERE u.id = influencers.created_by) AS created_by_name
         FROM influencers ${whereSql} ORDER BY ${orderBy} LIMIT ${pageSize} OFFSET ${offset}`,
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
    if (!(await userCanAccessPageKey(session, "influencers"))) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    await ensureInfluencerSchema();

    const d = await req.json().catch(() => null);
    if (!d || typeof d !== "object") return NextResponse.json({ message: "Invalid request body." }, { status: 400, headers: NO_STORE });

    const err = await validate(d);
    if (err) return NextResponse.json({ message: err }, { status: 400, headers: NO_STORE });

    const v = await coerce(d);
    const res = await query(
      `INSERT INTO influencers
        (name, phone, photo_url, address, assembly_id, assembly_name,
         district_id, district_name, lok_sabha_id, lok_sabha_name, zone_id, zone_name, influence_position,
         key_activities, political_journey, contested_election, election_type, election_year,
         election_constituency, election_party, election_result, election_votes,
         election_details, org_social_activity, economic_status, economic_profile, potential_rating,
         potential_areas, expected_contribution, potential_remarks, status, next_action, action_remarks,
         follow_up_date, responsible_person, join_date, cancelled_date, cancellation_remark, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        v.name, v.phone, v.photo_url, v.address, v.assembly_id, v.assembly_name,
        v.district_id, v.district_name, v.lok_sabha_id, v.lok_sabha_name, v.zone_id, v.zone_name, v.influence_position,
        v.key_activities, v.political_journey, v.contested_election, v.election_type, v.election_year,
        v.election_constituency, v.election_party, v.election_result, v.election_votes,
        v.election_details, v.org_social_activity, v.economic_status, v.economic_profile, v.potential_rating,
        v.potential_areas, v.expected_contribution, v.potential_remarks, v.status, v.next_action, v.action_remarks,
        v.follow_up_date, v.responsible_person, v.join_date, v.cancelled_date, v.cancellation_remark, session.user.id || null,
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
  // Cancelled requires a reason/remark (§12, §15, §21) — enforced server-side.
  if (normalizeStatus(d.status) === "Cancelled" && !String(d.cancellation_remark ?? "").trim()) {
    return "A cancellation reason/remark is required when the status is Cancelled.";
  }
  return null;
}

// Participation bookkeeping derived from the chosen status (§9–§13, §15). Pending
// clears the dates; Joined stamps a join date (kept if already set, else today);
// Cancelled stamps a cancel date + keeps the remark, and preserves a legitimate
// prior join date (a contact that joined and was later cancelled). `prior` is the
// existing DB row on edit (null on create).
function participationFields(status, d, prior) {
  const today = new Date().toISOString().slice(0, 10);
  const clip = (x) => { const v = String(x ?? "").trim(); return v || null; };
  const priorJoin = prior?.join_date ? String(prior.join_date).slice(0, 10) : null;
  if (status === "Joined") {
    return { join_date: clip(d.join_date) || priorJoin || today, cancelled_date: null, cancellation_remark: null };
  }
  if (status === "Cancelled") {
    const priorCancel = prior?.cancelled_date ? String(prior.cancelled_date).slice(0, 10) : null;
    return { join_date: priorJoin, cancelled_date: clip(d.cancelled_date) || priorCancel || today, cancellation_remark: clip(d.cancellation_remark) };
  }
  return { join_date: null, cancelled_date: null, cancellation_remark: null };
}

export async function coerce(d, prior = null) {
  // Assembly → District / Lok Sabha / Zone resolved authoritatively from master
  // data (never trusts client-supplied location names). Nulls where unmapped.
  const h = await resolveAssemblyHierarchy(d.assembly_id);
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
    photo_url: s(d.photo_url, 512),
    address: s(d.address),
    assembly_id: h.assembly_id, assembly_name: h.assembly_name,
    district_id: h.district_id, district_name: h.district_name,
    lok_sabha_id: h.lok_sabha_id, lok_sabha_name: h.lok_sabha_name,
    zone_id: h.zone_id, zone_name: h.zone_name,
    influence_position: s(d.influence_position),
    key_activities: packActivities(d.key_activities),
    political_journey: s(d.political_journey),
    contested_election: contested ? 1 : 0,
    election_type: contested ? s(d.election_type, 120) : null,
    election_year: contested ? s(d.election_year, 12) : null,
    election_constituency: contested ? s(d.election_constituency, 160) : null,
    election_party: contested ? s(d.election_party, 120) : null,
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
    ...participationFields(normalizeStatus(d.status), d, prior),
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
