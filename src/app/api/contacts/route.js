import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { isAdmin, scopeFilterSync } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisor(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status"); // all | pending | done | assigned | pool
    const duplicates = searchParams.get("duplicates"); // "1" → only likely-duplicate contacts
    const district_id = searchParams.get("district_id");
    const assembly_id = searchParams.get("assembly_id");
    const designation_id = searchParams.get("designation_id");
    const assigned_to = searchParams.get("assigned_to");
    const search = searchParams.get("search");

    // Build the shared WHERE clause once (used for both the count and the list).
    let where = " WHERE 1=1";
    const params = [];
    if (status === "pending") where += " AND c.is_completed = 0";
    if (status === "done") where += " AND c.is_completed = 1";
    if (status === "assigned") where += " AND c.assigned_to_user_id IS NOT NULL";
    if (status === "pool") where += " AND c.assigned_to_user_id IS NULL";
    if (district_id) { where += " AND c.district_id = ?"; params.push(district_id); }
    if (assembly_id) { where += " AND c.assembly_id = ?"; params.push(assembly_id); }
    if (designation_id) { where += " AND c.designation_id = ?"; params.push(designation_id); }
    if (assigned_to) { where += " AND c.assigned_to_user_id = ?"; params.push(assigned_to); }
    if (search) {
      where += " AND (c.person_name LIKE ? OR c.phone_number LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }
    // Likely duplicates: phone_number is UNIQUE, so real-world duplicates are the
    // same person saved with a differently formatted number (+91/0 prefix) or the
    // same name entered twice. Match on last-10-digits of the phone OR exact name.
    if (duplicates === "1") {
      where += ` AND (
        RIGHT(REGEXP_REPLACE(c.phone_number, '[^0-9]', ''), 10) IN (
          SELECT p FROM (
            SELECT RIGHT(REGEXP_REPLACE(phone_number, '[^0-9]', ''), 10) AS p
              FROM contacts GROUP BY p HAVING COUNT(*) > 1
          ) dup_phones
        )
        OR LOWER(TRIM(c.person_name)) IN (
          SELECT n FROM (
            SELECT LOWER(TRIM(person_name)) AS n
              FROM contacts GROUP BY n HAVING COUNT(*) > 1
          ) dup_names
        )
      )`;
    }
    // Geographic scope from role
    const scope = scopeFilterSync(session.user, "c");
    where += " " + scope.where;
    params.push(...scope.params);

    // Total matching the current filters (not capped by the list limit).
    const countRows = await query(`SELECT COUNT(*) AS total FROM contacts c ${where}`, params);
    const total = Number(countRows[0]?.total || 0);

    const contacts = await query(
      `SELECT c.*,
              u.username AS assigned_to_username,
              ld.name AS district_name,
              lw.name AS ward_name,
              dsg.name AS designation_name
         FROM contacts c
         LEFT JOIN users u ON u.id = c.assigned_to_user_id
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations lw ON lw.id = c.ward_id
         LEFT JOIN designations dsg ON dsg.id = c.designation_id
         ${where}
        ORDER BY ${duplicates === "1"
          ? "LOWER(TRIM(c.person_name)) ASC, RIGHT(REGEXP_REPLACE(c.phone_number, '[^0-9]', ''), 10) ASC, c.id ASC"
          : "c.is_completed ASC, c.id DESC"}
        LIMIT 500`,
      params
    );
    return NextResponse.json({ contacts, total });
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
    const res = await query(
      `INSERT INTO contacts (person_name, phone_number, address, designation_id, district_id, ward_id, booth_id, assigned_to_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [person_name, phone_number, address || null, designation_id || null, district_id || null, ward_id || null, booth_id || null, assigned_to_user_id || null]
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
