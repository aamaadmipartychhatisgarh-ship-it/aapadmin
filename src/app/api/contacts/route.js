import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { isAdmin, scopeFilterSync } from "@/lib/permissions";
import { query } from "@/lib/db";
import { contactsHaveAssignedAt, contactsHaveAssignedBy } from "@/lib/assignmentRules";
import { buildContactPersonFilter } from "@/lib/contactFilter";
import { statusWhere } from "@/lib/contactStatus";
import { notWrongNumberClause } from "@/lib/contactExtras";

// Parse a "1,2,3" style query value into a de-duped list of positive integers.
function idList(raw) {
  if (!raw) return [];
  return [...new Set(String(raw).split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0))];
}

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisor(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status"); // all | pending | done | assigned | pool
    const duplicates = searchParams.get("duplicates"); // "1" → only likely-duplicate contacts
    const wrong = searchParams.get("wrong"); // "1" → only contacts whose latest call was a Wrong Number
    const zone_id = searchParams.get("zone_id");
    const lok_sabha_id = searchParams.get("lok_sabha_id");
    const district_id = searchParams.get("district_id");
    // assembly_id / designation_id accept a single value OR a comma-separated
    // list (assembly_ids / designation_ids) so several can be picked at once.
    const assembly_ids = idList(searchParams.get("assembly_ids") || searchParams.get("assembly_id"));
    const designation_ids = idList(searchParams.get("designation_ids") || searchParams.get("designation_id"));
    const assigned_to = searchParams.get("assigned_to");
    const search = searchParams.get("search");
    // Pagination — bounded so a huge table returns one page, not everything.
    const page = Math.max(1, parseInt(searchParams.get("page"), 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("page_size"), 10) || 50));
    const offset = (page - 1) * pageSize;

    // Build the shared WHERE clause once (used for both the count and the list).
    let where = " WHERE 1=1";
    const params = [];
    const statusCond = statusWhere(status);
    if (statusCond) where += ` AND ${statusCond}`;
    // Wrong Number contacts live only in the dedicated Wrong Numbers module —
    // excluded from every other view of Contacts by default. The `wrong=1`
    // branch below is the one deliberate exception (it's what THAT module
    // itself queries), so skip the exclusion there.
    if (wrong !== "1") where += await notWrongNumberClause("c");
    // Zone / Lok Sabha / District / Assembly / Designation — filter by the PERSON
    // (their linked worker) via the shared helper, so the same selection returns
    // the same people as the Add Workers page and the Distribution panel.
    const person = buildContactPersonFilter({ zone_id, lok_sabha_id, district_id, assembly_ids, designation_ids });
    where += person.where;
    params.push(...person.params);
    if (assigned_to) { where += " AND c.assigned_to_user_id = ?"; params.push(assigned_to); }
    if (search) {
      where += " AND (c.person_name LIKE ? OR c.phone_number LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }
    // Duplicates: phone_number is UNIQUE, so duplicates are the same number saved
    // in different formats (+91/0 prefix, spaces). Match on the last 10 digits.
    if (duplicates === "1") {
      where += ` AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.phone_number, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', ''), 10) IN (
        SELECT p FROM (
          SELECT RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone_number, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', ''), 10) AS p
            FROM contacts GROUP BY p HAVING COUNT(*) > 1
        ) dup_phones
      )`;
    }
    // Wrong numbers: contacts whose most recent call outcome was "Wrong Number"
    // AND whose current phone still matches the number that was called — so
    // once an admin corrects the number, the contact drops off this list and
    // returns to the normal calling list. Keep identical to the bulk-delete
    // endpoint.
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
    // Geographic scope from role
    const scope = scopeFilterSync(session.user, "c");
    where += " " + scope.where;
    params.push(...scope.params);

    // Always join the linked worker: person-aware filtering resolves through it,
    // AND the displayed designation must mirror Add Workers (the worker's full
    // multi-role `position` text), which the contact's single designation_id
    // often can't represent.
    const workerJoin = "LEFT JOIN workers w ON w.id = c.worker_id";

    // Total matching the current filters (not capped by the list limit).
    const countRows = await query(`SELECT COUNT(*) AS total FROM contacts c ${workerJoin} ${where}`, params);
    const total = Number(countRows[0]?.total || 0);

    const contacts = await query(
      `SELECT c.*,
              u.username AS assigned_to_username,
              ld.name AS district_name,
              lw.name AS ward_name,
              -- Mirror Add Workers: show the worker's position (source of truth)
              -- when linked; fall back to the contact's own designation otherwise.
              COALESCE(NULLIF(TRIM(w.position), ''), dsg.name) AS designation_name,
              -- Contacts have their own native photo_url now; COALESCE only
              -- covers rows from before that column existed whose backfill
              -- (scripts/add-contact-photo-url.mjs) somehow missed them.
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
    console.error("contacts GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const data = await req.json();
    const { person_name, phone_number, address, designation_id, district_id, ward_id, booth_id, assigned_to_user_id } = data;
    if (!person_name || !phone_number) {
      return NextResponse.json({ message: "Name and phone are required" }, { status: 400 });
    }
    // Record assignment metadata (who/when) when the new contact is created
    // already assigned to a caller, so their "Assigned by" line has data.
    const cols = ["person_name", "phone_number", "address", "designation_id", "district_id", "ward_id", "booth_id", "assigned_to_user_id"];
    const vals = [person_name, phone_number, address || null, designation_id || null, district_id || null, ward_id || null, booth_id || null, assigned_to_user_id || null];
    if (assigned_to_user_id) {
      if (await contactsHaveAssignedAt()) { cols.push("assigned_at"); vals.push(new Date()); }
      if (await contactsHaveAssignedBy()) { cols.push("assigned_by_user_id"); vals.push(session.user.id); }
    }
    const res = await query(
      `INSERT INTO contacts (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      vals
    );
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return NextResponse.json({ message: "A contact with this phone number already exists" }, { status: 409 });
    }
    console.error("contacts POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
