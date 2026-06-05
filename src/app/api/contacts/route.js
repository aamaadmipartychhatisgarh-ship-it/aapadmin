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
    const district_id = searchParams.get("district_id");
    const assigned_to = searchParams.get("assigned_to");
    const search = searchParams.get("search");

    let sql = `
      SELECT c.*,
             u.username AS assigned_to_username,
             ld.name AS district_name,
             lw.name AS ward_name
        FROM contacts c
        LEFT JOIN users u ON u.id = c.assigned_to_user_id
        LEFT JOIN locations ld ON ld.id = c.district_id
        LEFT JOIN locations lw ON lw.id = c.ward_id
       WHERE 1=1
    `;
    const params = [];
    if (status === "pending") sql += " AND c.is_completed = 0";
    if (status === "done") sql += " AND c.is_completed = 1";
    if (status === "assigned") sql += " AND c.assigned_to_user_id IS NOT NULL";
    if (status === "pool") sql += " AND c.assigned_to_user_id IS NULL";
    if (district_id) { sql += " AND c.district_id = ?"; params.push(district_id); }
    if (assigned_to) { sql += " AND c.assigned_to_user_id = ?"; params.push(assigned_to); }
    if (search) {
      sql += " AND (c.person_name LIKE ? OR c.phone_number LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }
    // Geographic scope from role
    const scope = scopeFilterSync(session.user, "c");
    sql += " " + scope.where;
    params.push(...scope.params);
    sql += " ORDER BY c.is_completed ASC, c.id DESC LIMIT 500";

    const contacts = await query(sql, params);
    return NextResponse.json({ contacts });
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
    const { person_name, phone_number, address, district_id, ward_id, booth_id, assigned_to_user_id } = data;
    if (!person_name || !phone_number) {
      return NextResponse.json({ message: "Name and phone are required" }, { status: 400 });
    }
    const res = await query(
      `INSERT INTO contacts (person_name, phone_number, address, district_id, ward_id, booth_id, assigned_to_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [person_name, phone_number, address || null, district_id || null, ward_id || null, booth_id || null, assigned_to_user_id || null]
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
