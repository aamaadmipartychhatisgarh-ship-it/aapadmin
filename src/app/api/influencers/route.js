import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { userCanAccessPageKey } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import {
  ensureInfluencerSchema, getInfluencerColumns, normalizeStatus, normalizeRating, resolveAssemblyHierarchy,
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
    // Added By / Created By is ALWAYS the authenticated user — never client-supplied.
    const record = { ...v, created_by: session.user.id || null };
    // Build the column list from the columns that actually exist on the table, so a
    // deployment where a newer column (e.g. join_date) was never migrated still saves
    // the core record instead of failing with an "Unknown column" 500. `created_by`
    // and the core fields have existed since the table was created, so the essential
    // save always succeeds.
    const cols = await getInfluencerColumns();
    const names = Object.keys(record).filter((k) => cols.has(k));
    if (!names.includes("name")) {
      // Table isn't reachable / has no expected columns — surface, don't fake success.
      throw new Error("influencers table is missing expected columns");
    }
    const res = await query(
      `INSERT INTO influencers (${names.map((n) => `\`${n}\``).join(", ")}) VALUES (${names.map(() => "?").join(",")})`,
      names.map((n) => record[n])
    );
    const [row] = await query("SELECT * FROM influencers WHERE id = ?", [res.insertId]);
    return NextResponse.json({ influencer: shape(row) }, { status: 201, headers: NO_STORE });
  } catch (err) {
    // Log the ACTUAL cause (SQL error code + driver message) so a genuine failure
    // is diagnosable server-side; never leak it to the client (§14, §15).
    console.error("[influencer] POST error:", err?.code || "", err?.sqlMessage || err?.message || err);
    return NextResponse.json({ message: "Could not save the influencer. Please try again." }, { status: 500, headers: NO_STORE });
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
  // Age, when provided, must be a sensible whole number.
  if (d.age != null && String(d.age).trim() !== "") {
    const n = Number(d.age);
    if (!Number.isInteger(n) || n < 1 || n > 120) return "Enter a valid age (1–120).";
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
  const ageStr = String(d.age ?? "").trim();
  const age = ageStr && Number.isInteger(Number(ageStr)) ? Number(ageStr) : null;
  // Only the fields the current module writes are returned. Superseded columns
  // (influence_position, key_activities, political_journey, contested_election,
  // election_*, org_social_activity, economic_profile, potential_areas,
  // expected_contribution, potential_remarks, next_action, action_remarks,
  // follow_up_date, responsible_person) are intentionally OMITTED, so the dynamic
  // INSERT/UPDATE never touches them — existing historical values are preserved.
  return {
    name: String(d.name).trim().slice(0, 150),
    phone: s(d.phone, 30),
    photo_url: s(d.photo_url, 512),
    address: s(d.address),
    assembly_id: h.assembly_id, assembly_name: h.assembly_name,
    district_id: h.district_id, district_name: h.district_name,
    lok_sabha_id: h.lok_sabha_id, lok_sabha_name: h.lok_sabha_name,
    zone_id: h.zone_id, zone_name: h.zone_name,
    // Profile Details
    age,
    caste: s(d.caste, 120),
    current_party: s(d.current_party, 160),
    // Political Journey
    party_years: s(d.party_years, 60),
    political_position: s(d.political_position, 200),
    org_position: s(d.org_position, 200),
    associated_since: s(d.associated_since, 60),
    // Social Activity
    social_media: s(d.social_media, 400),
    team_size: s(d.team_size, 60),
    social_reach: s(d.social_reach),
    // Economic Status / Influence Assessment
    economic_status: s(d.economic_status, 80),
    potential_rating: normalizeRating(d.potential_rating),
    // Participation
    status: normalizeStatus(d.status),
    ...participationFields(normalizeStatus(d.status), d, prior),
  };
}

// Shape a DB row for the API. key_activities is a retired column (may hold legacy
// JSON) — decoded to an array for backward-compatible read-only display.
export function shape(row) {
  if (!row) return row;
  let activities = [];
  if (row.key_activities) {
    try { const p = JSON.parse(row.key_activities); if (Array.isArray(p)) activities = p; }
    catch { activities = String(row.key_activities).split("\n").filter(Boolean); }
  }
  return { ...row, key_activities: activities };
}
