import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { userCanAccessPageKey } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import {
  ensureInfluencerSchema, getInfluencerColumns, normalizeStatus, resolveAssemblyHierarchy,
  POTENTIAL_RATINGS, STATUSES, NEXT_ACTIONS, ECONOMIC_STATUSES,
} from "@/lib/influencerSchema";
import { ensureContactDesignationsSchema } from "@/lib/contactDesignations";

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
      // Party buckets for the dashboard cards + assembly table — BJP / INC / Others,
      // classified from the influencer's saved Party (current_party). NULL/blank/any
      // other party falls into Others, so every influencer is counted exactly once
      // and Total = BJP + INC + Others. `current_party` is feature-detected: on a
      // deployment where the column's ALTER never ran it simply resolves to 0 BJP /
      // 0 INC / all Others instead of failing the whole stats query (which would
      // blank the cards and the assembly list). `alias` prefixes the column for the
      // assembly LEFT JOIN, where a no-influencer row (i.id IS NULL) counts as none.
      const cols = await getInfluencerColumns();
      const hasParty = cols.has("current_party");
      const bjpExpr = (alias) => hasParty ? `(LOWER(${alias}current_party) = 'bjp' OR LOWER(${alias}current_party) LIKE '%bharatiya janata%')` : "(1=0)";
      const incExpr = (alias) => hasParty ? `(LOWER(${alias}current_party) IN ('inc','congress','indian national congress') OR LOWER(${alias}current_party) LIKE '%congress%')` : "(1=0)";
      const BJP = bjpExpr("");
      const INC = incExpr("");
      const [totals] = await query(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(status = 'Joined'), 0) AS joined,
                COALESCE(SUM(status = 'Pending'), 0) AS pending,
                COALESCE(SUM(status = 'Cancelled'), 0) AS cancelled,
                COALESCE(SUM(CASE WHEN ${BJP} THEN 1 ELSE 0 END), 0) AS bjp,
                COALESCE(SUM(CASE WHEN ${INC} THEN 1 ELSE 0 END), 0) AS inc,
                COALESCE(SUM(CASE WHEN ${BJP} THEN 0 WHEN ${INC} THEN 0 ELSE 1 END), 0) AS others
           FROM influencers`
      );
      const iBJP = bjpExpr("i.");
      const iINC = incExpr("i.");
      const assemblies = await query(
        `SELECT a.id AS assembly_id, a.name AS assembly_name,
                COUNT(i.id) AS total,
                COALESCE(SUM(i.status = 'Joined'), 0) AS joined,
                COALESCE(SUM(i.status = 'Pending'), 0) AS pending,
                COALESCE(SUM(i.status = 'Cancelled'), 0) AS cancelled,
                COALESCE(SUM(CASE WHEN i.id IS NULL THEN 0 WHEN ${iBJP} THEN 1 ELSE 0 END), 0) AS bjp,
                COALESCE(SUM(CASE WHEN i.id IS NULL THEN 0 WHEN ${iINC} THEN 1 ELSE 0 END), 0) AS inc,
                COALESCE(SUM(CASE WHEN i.id IS NULL THEN 0 WHEN ${iBJP} THEN 0 WHEN ${iINC} THEN 0 ELSE 1 END), 0) AS others
           FROM locations a
           LEFT JOIN influencers i ON i.assembly_id = a.id
          WHERE a.type = 'assembly'
          GROUP BY a.id, a.name
          ORDER BY a.name ASC`
      );
      const num = (r) => ({ ...r, total: Number(r.total) || 0, joined: Number(r.joined) || 0, pending: Number(r.pending) || 0, cancelled: Number(r.cancelled) || 0, bjp: Number(r.bjp) || 0, inc: Number(r.inc) || 0, others: Number(r.others) || 0 });
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
    // The contact_designations table must exist for the Joined By designation
    // subquery (idempotent + cached — no-op once created).
    await ensureContactDesignationsSchema();
    // Only reference joined_by_contact_id when the column actually exists — a
    // deployment where the lazy ALTER couldn't run (no ALTER privilege) still lists
    // every existing influencer instead of failing the whole page with an
    // "Unknown column" 500. Older records simply have no Joined By.
    // Joined By is resolved LIVE from the linked Contact (never copied): name,
    // photo (contact's own or its linked worker's), mobile and designation(s) —
    // the contact's own multi-designation set, else the linked worker's position,
    // else the legacy single designation. Scalar subqueries keep the FROM as
    // `influencers` alone, so the WHERE/search columns stay unambiguous.
    const cols = await getInfluencerColumns();
    const hasJbId = cols.has("joined_by_contact_id");
    const hasJbPhone = cols.has("joined_by_phone");
    // pageSize/offset are validated integers (parseInt + clamp above), so they
    // are inlined — mysql2's prepared execute() rejects LIMIT/OFFSET placeholders.
    let rows;
    if (hasJbId || hasJbPhone) {
      // Joined By resolves the EFFECTIVE contact: the stored link id, else a match
      // on the saved phone number (last-10-digits, same normalization as the
      // Contacts lookup) — so existing records that only stored the phone (or were
      // saved before the link resolved) still show the person. The mobile always
      // falls back to the saved joined_by_phone, so the number shows even when the
      // person isn't in Contacts. Resolution runs only on the paged slice (a
      // derived table LIMITed first), and the phone match runs only for rows with
      // no link (COALESCE short-circuits) — never the influencer's own details.
      const digits = (col) => `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${col},' ',''),'-',''),'+',''),'(',''),')',''),'.','')`;
      const phoneMatch = hasJbPhone
        ? `(SELECT c2.id FROM contacts c2
              WHERE base.joined_by_phone IS NOT NULL
                AND LENGTH(${digits("base.joined_by_phone")}) >= 10
                AND RIGHT(${digits("c2.phone_number")}, 10) = RIGHT(${digits("base.joined_by_phone")}, 10)
              LIMIT 1)`
        : null;
      const effId = hasJbId && phoneMatch ? `COALESCE(base.joined_by_contact_id, ${phoneMatch})`
        : hasJbId ? "base.joined_by_contact_id"
        : phoneMatch;
      const mobileExpr = hasJbPhone ? "COALESCE(jc.phone_number, base.joined_by_phone)" : "jc.phone_number";
      rows = await query(
        `SELECT base.*,
                (SELECT username FROM users u WHERE u.id = base.created_by) AS created_by_name,
                jc.person_name AS joined_by_name,
                COALESCE(jc.photo_url, jcw.photo_url) AS joined_by_photo,
                ${mobileExpr} AS joined_by_mobile,
                COALESCE(
                  (SELECT GROUP_CONCAT(dd.name ORDER BY dd.name SEPARATOR ', ')
                     FROM contact_designations cd JOIN designations dd ON dd.id = cd.designation_id
                    WHERE cd.contact_id = jc.id),
                  NULLIF(TRIM(jcw.position), ''),
                  jdsg.name) AS joined_by_designation
           FROM (
             SELECT influencers.* FROM influencers ${whereSql} ORDER BY ${orderBy} LIMIT ${pageSize} OFFSET ${offset}
           ) base
           LEFT JOIN contacts jc ON jc.id = ${effId}
           LEFT JOIN workers jcw ON jcw.id = jc.worker_id
           LEFT JOIN designations jdsg ON jdsg.id = jc.designation_id
          ORDER BY base.${orderBy}`,
        params
      );
    } else {
      rows = await query(
        `SELECT influencers.*,
                (SELECT username FROM users u WHERE u.id = influencers.created_by) AS created_by_name
           FROM influencers ${whereSql} ORDER BY ${orderBy} LIMIT ${pageSize} OFFSET ${offset}`,
        params
      );
    }
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
  let payload = null; // kept in scope so a failure can log exactly what was sent
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (!(await userCanAccessPageKey(session, "influencers"))) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    await ensureInfluencerSchema();

    const d = await req.json().catch(() => null);
    payload = d;
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
    // Read the row back so a fake success is impossible: if the INSERT didn't
    // persist, there is no row and we surface a real error instead of "saved".
    const [row] = await query("SELECT * FROM influencers WHERE id = ?", [res.insertId]);
    if (!row) throw new Error("insert reported success but the record could not be read back");
    return NextResponse.json({ influencer: shape(row) }, { status: 201, headers: NO_STORE });
  } catch (err) {
    // Log the ACTUAL cause (SQL error code + driver message) AND the payload that
    // was sent, so a genuine failure is fully diagnosable server-side.
    const detail = err?.sqlMessage || err?.message || String(err);
    console.error("[influencer] POST error:", err?.code || "", detail, "| payload:", JSON.stringify(payload));
    // Surface the real reason to the (admin/supervisor-only) client so a save
    // failure is never hidden behind a generic message and never mistaken for a
    // silent "saved but not showing" (Bug Fix §2, §7).
    return NextResponse.json({ message: `Could not save the influencer: ${detail}` }, { status: 500, headers: NO_STORE });
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
  // Influencer Rating, when provided, must be 1–10.
  if (d.influencer_rating != null && String(d.influencer_rating).trim() !== "") {
    const ir = Number(d.influencer_rating);
    if (!Number.isInteger(ir) || ir < 1 || ir > 10) return "Influencer Rating must be a whole number from 1 to 10.";
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
  // "Joined By" links an EXISTING contact — when supplied it must be a real
  // contact id (the lookup resolved it), never a free-typed/duplicate person.
  if (d.joined_by_contact_id != null && String(d.joined_by_contact_id).trim() !== "") {
    const jb = parseInt(d.joined_by_contact_id, 10);
    if (!Number.isInteger(jb) || jb <= 0) return "Invalid Joined By contact.";
    const rows = await query("SELECT id FROM contacts WHERE id = ? LIMIT 1", [jb]);
    if (!rows.length) return "The selected Joined By contact could not be found.";
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
    // Economic Status
    economic_status: s(d.economic_status, 80),
    // Influencer Rating (1–10) — replaces the old Influence Assessment. Anything
    // outside 1–10 stores NULL (potential_rating is retained but no longer written).
    influencer_rating: ratingInt(d.influencer_rating),
    // Joined By — a live link to an existing Contact (id) + the looked-up phone.
    joined_by_contact_id: jbContactId(d.joined_by_contact_id),
    joined_by_phone: s(d.joined_by_phone, 30),
    // Free multiline remark (participation / follow-up / communication / joining …).
    remark: s(d.remark),
    // Participation
    status: normalizeStatus(d.status),
    ...participationFields(normalizeStatus(d.status), d, prior),
  };
}

// A positive integer contact id, or null (never a copied person record).
function jbContactId(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// A 1–10 rating, or null for anything else (blank / out of range).
function ratingInt(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
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
