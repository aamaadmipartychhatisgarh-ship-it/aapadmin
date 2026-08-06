import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSupervisorRole, normalizeRole, ROLES } from "@/lib/permissions";
import { query } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { buildContactPersonFilter } from "@/lib/contactFilter";
import { statusWhere } from "@/lib/contactStatus";
import { notWrongNumberClause } from "@/lib/contactExtras";
import { supervisorScopeFilter, supervisorCallerScopeFilter, supervisorTerritory } from "@/lib/supervisorScope";

// Supervisor-scoped mirror of GET /api/contacts (src/app/api/contacts/route.js)
// — same filters, same shape, same pagination — but gated to the strict
// Supervisor role and ALWAYS scoped to the supervisor's own territory via
// supervisorScopeFilter (never bypassable, unlike scopeFilterSync's
// "supervisor sees everything" default used by the admin route).
function idList(raw) {
  if (!raw) return [];
  return [...new Set(String(raw).split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0))];
}

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisorRole(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const duplicates = searchParams.get("duplicates");
    const wrong = searchParams.get("wrong");
    const zone_id = searchParams.get("zone_id");
    const lok_sabha_id = searchParams.get("lok_sabha_id");
    const district_id = searchParams.get("district_id");
    const assembly_ids = idList(searchParams.get("assembly_ids") || searchParams.get("assembly_id"));
    const designation_ids = idList(searchParams.get("designation_ids") || searchParams.get("designation_id"));
    const assigned_to = searchParams.get("assigned_to");
    const search = searchParams.get("search");
    const page = Math.max(1, parseInt(searchParams.get("page"), 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("page_size"), 10) || 50));
    const offset = (page - 1) * pageSize;

    let where = " WHERE 1=1";
    const params = [];
    const statusCond = statusWhere(status);
    if (statusCond) where += ` AND ${statusCond}`;
    if (wrong !== "1") where += await notWrongNumberClause("c");
    const person = buildContactPersonFilter({ zone_id, lok_sabha_id, district_id, assembly_ids, designation_ids });
    where += person.where;
    params.push(...person.params);
    if (assigned_to) { where += " AND c.assigned_to_user_id = ?"; params.push(assigned_to); }
    if (search) {
      where += " AND (c.person_name LIKE ? OR c.phone_number LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }
    if (duplicates === "1") {
      where += ` AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.phone_number, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', ''), 10) IN (
        SELECT p FROM (
          SELECT RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone_number, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', ''), 10) AS p
            FROM contacts GROUP BY p HAVING COUNT(*) > 1
        ) dup_phones
      )`;
    }
    if (wrong === "1") {
      where += ` AND (
        SELECT csx.name FROM calls cx
          JOIN call_statuses csx ON csx.id = cx.status_id
         WHERE cx.contact_id = c.id
         ORDER BY cx.called_at DESC, cx.id DESC LIMIT 1
      ) = 'Wrong Number'
      AND (
        SELECT cx.phone_number FROM calls cx
         WHERE cx.contact_id = c.id
         ORDER BY cx.called_at DESC, cx.id DESC LIMIT 1
      ) = c.phone_number`;
    }
    // Strict, non-bypassable territory scope — the whole point of this route.
    const scope = supervisorScopeFilter(session.user, "c");
    where += " " + scope.where;
    params.push(...scope.params);

    const workerJoin = "LEFT JOIN workers w ON w.id = c.worker_id";

    const countRows = await query(`SELECT COUNT(*) AS total FROM contacts c ${workerJoin} ${where}`, params);
    const total = Number(countRows[0]?.total || 0);

    const contacts = await query(
      `SELECT c.*,
              u.username AS assigned_to_username,
              ld.name AS district_name,
              lw.name AS ward_name,
              COALESCE(NULLIF(TRIM(w.position), ''), dsg.name) AS designation_name,
              -- Contacts have their own native photo_url now; COALESCE only
              -- covers rows whose backfill (scripts/add-contact-photo-url.mjs)
              -- somehow missed them.
              COALESCE(c.photo_url, w.photo_url) AS photo_url
         FROM contacts c
         ${workerJoin}
         LEFT JOIN users u ON u.id = c.assigned_to_user_id
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations lw ON lw.id = c.ward_id
         LEFT JOIN designations dsg ON dsg.id = c.designation_id
         ${where}
        ORDER BY ${duplicates === "1"
          ? "RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.phone_number, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', ''), 10) ASC, c.id ASC"
          : "c.is_completed ASC, c.id DESC"}
        LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    return NextResponse.json({ contacts, total, page, page_size: pageSize });
  } catch (err) {
    console.error("supervisor contacts GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// Which of the geo columns actually exist on `contacts` in this deployment
// (schemas have drifted across environments — same defensive detection the
// admin route and the [id] route use).
let contactColumnsPromise;
async function getContactColumns() {
  if (!contactColumnsPromise) {
    contactColumnsPromise = query(
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts'`
    )
      .then((rows) => new Set(rows.map((r) => r.name)))
      .catch((err) => { contactColumnsPromise = undefined; throw err; });
  }
  return contactColumnsPromise;
}

// POST /api/supervisor/contacts — supervisor-scoped mirror of POST
// /api/contacts (Add Contact). Identical workflow to the admin's, with one
// server-enforced difference: the new contact's geography is stamped from the
// supervisor's OWN territory, never from arbitrary client input, so a created
// contact ALWAYS lands inside the supervisor's scope (and can never be planted
// outside it). An optional initial caller assignment is validated to be a
// caller within the supervisor's territory, exactly like the [id] PUT.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisorRole(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    // territory is null for an unconfigured (full-oversight) supervisor — they
    // add contacts like an admin (free district choice), not locked to an anchor.
    const territory = await supervisorTerritory(session.user, query);

    const data = await req.json();
    const { person_name, phone_number, address, designation_id, assigned_to_user_id } = data;
    if (!person_name || !phone_number) {
      return NextResponse.json({ message: "Name and phone are required" }, { status: 400 });
    }

    // An initial assignment (optional) must be to a caller this supervisor may
    // assign to (their territory, or any caller when unconfigured).
    if (assigned_to_user_id) {
      const callerScope = supervisorCallerScopeFilter(session.user, "u");
      const rows = await query(
        `SELECT id, role FROM users u WHERE u.id = ? ${callerScope.where}`,
        [assigned_to_user_id, ...callerScope.params]
      );
      const target = rows[0];
      if (!target || normalizeRole(target.role) !== ROLES.CALLER) {
        return NextResponse.json({ message: "That caller is not in your territory." }, { status: 403 });
      }
    }

    // Geography is dictated by the supervisor's anchor (assembly > district >
    // zone), NOT by arbitrary client input, so a new contact always lands in
    // scope. Contacts are keyed by district_id (see supervisorScopeFilter), so
    // every stamped contact must carry a district_id within the supervisor's
    // reach — otherwise it would be invisible in their own (district-scoped) list.
    const geo = {};
    if (territory) {
      if (territory.zone) geo.zone_id = territory.zone.id;
      if (territory.lok_sabha) geo.lok_sabha_id = territory.lok_sabha.id;
      if (territory.district) geo.district_id = territory.district.id;
      if (territory.assembly) geo.assembly_id = territory.assembly.id;
      // A zone-level supervisor has no fixed district, so they MUST pick one —
      // and only a district that belongs to their zone.
      if (territory.level === "zone") {
        const rows = data.district_id ? await query(
          `SELECT d.id, ls.id AS lok_sabha_id
             FROM locations d
             JOIN locations ls ON ls.id = d.parent_id AND ls.type = 'lok_sabha'
            WHERE d.id = ? AND ls.parent_id = ?`,
          [data.district_id, territory.zone.id]
        ) : [];
        if (!rows[0]) {
          return NextResponse.json({ message: "Pick a district within your zone for this contact." }, { status: 400 });
        }
        geo.district_id = rows[0].id;
        geo.lok_sabha_id = rows[0].lok_sabha_id;
      }
    } else if (data.district_id) {
      // Unconfigured supervisor (full oversight): honor the chosen district.
      geo.district_id = data.district_id;
    }

    const existingColumns = await getContactColumns();
    const cols = [];
    const vals = [];
    const add = (col, val) => { if (existingColumns.has(col)) { cols.push(col); vals.push(val); } };
    add("person_name", person_name);
    add("phone_number", phone_number);
    add("address", address || null);
    add("designation_id", designation_id || null);
    for (const [col, val] of Object.entries(geo)) add(col, val);
    add("assigned_to_user_id", assigned_to_user_id || null);
    if (assigned_to_user_id) {
      if (existingColumns.has("assigned_at")) add("assigned_at", new Date());
      if (existingColumns.has("assigned_by_user_id")) add("assigned_by_user_id", session.user.id);
    }

    const res = await query(
      `INSERT INTO contacts (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      vals
    );
    await logAudit(session, { action: "contact.create", entityType: "contact", entityId: res.insertId, details: { supervisor: true, territory: territory.level } });
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return NextResponse.json({ message: "A contact with this phone number already exists" }, { status: 409 });
    }
    console.error("supervisor contacts POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
