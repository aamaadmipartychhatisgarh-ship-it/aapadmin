import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canManageWorkers, scopeFilterSync } from "@/lib/permissions";
import { query } from "@/lib/db";

// GET /api/workers?search=&zone_id=&lok_sabha_id=&district_id=&assembly_id=&status=&position=&page=&limit=
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canManageWorkers(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search");
    const zoneId = searchParams.get("zone_id");
    const lokSabhaId = searchParams.get("lok_sabha_id");
    const districtId = searchParams.get("district_id");
    const assemblyId = searchParams.get("assembly_id");
    const status = searchParams.get("status");
    const position = searchParams.get("position");
    const duplicates = searchParams.get("duplicates"); // "1" → only same-mobile duplicates
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];
    if (search) { where.push("(w.name LIKE ? OR w.mobile LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
    if (zoneId) { where.push("w.zone_id = ?"); params.push(zoneId); }
    if (lokSabhaId) { where.push("w.lok_sabha_id = ?"); params.push(lokSabhaId); }
    if (districtId) { where.push("w.district_id = ?"); params.push(districtId); }
    if (assemblyId) { where.push("w.assembly_id = ?"); params.push(assemblyId); }
    if (status) { where.push("w.status = ?"); params.push(status); }
    // position holds one or more comma-separated designations ("A, B") — match any.
    if (position) { where.push("(w.position = ? OR FIND_IN_SET(?, REPLACE(w.position, ', ', ',')))"); params.push(position, position); }
    // Duplicate workers = same mobile (last 10 digits) appearing more than once.
    if (duplicates === "1") {
      where.push(`w.mobile IS NOT NULL AND RIGHT(REGEXP_REPLACE(w.mobile, '[^0-9]', ''), 10) IN (
        SELECT p FROM (
          SELECT RIGHT(REGEXP_REPLACE(mobile, '[^0-9]', ''), 10) AS p
            FROM workers WHERE mobile IS NOT NULL GROUP BY p HAVING COUNT(*) > 1
        ) dup_mobiles
      )`);
    }
    // Geographic scope from role
    const scope = scopeFilterSync(session.user, "w");
    if (scope.where) { where.push(scope.where.replace(/^AND /, "")); params.push(...scope.params); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [[{ total }]] = await query(`SELECT COUNT(*) AS total FROM workers w ${whereSql}`, params).then((r) => [r]);

    const workers = await query(
      `SELECT w.*, ld.name AS district_name, la.name AS assembly_name,
              lz.name AS zone_name, lls.name AS lok_sabha_name
         FROM workers w
         LEFT JOIN locations ld ON ld.id = w.district_id
         LEFT JOIN locations la ON la.id = w.assembly_id
         LEFT JOIN locations lz ON lz.id = w.zone_id
         LEFT JOIN locations lls ON lls.id = w.lok_sabha_id
         ${whereSql}
         ORDER BY ${duplicates === "1"
           ? "RIGHT(REGEXP_REPLACE(w.mobile, '[^0-9]', ''), 10) ASC, w.id ASC"
           : "w.activity_score DESC, w.id DESC"}
         LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return NextResponse.json({ workers, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error("workers GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canManageWorkers(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const d = await req.json();
    if (!d.name) return NextResponse.json({ message: "Name is required" }, { status: 400 });

    const mobile = d.mobile ? String(d.mobile).trim().replace(/[^\d+]/g, "") : null;

    // One mobile number → one worker. Compare on the last 10 digits so
    // "+91 98765..." and "098765..." count as the same number.
    if (mobile) {
      const [dup] = await query(
        `SELECT id, name FROM workers
          WHERE mobile IS NOT NULL
            AND RIGHT(REGEXP_REPLACE(mobile, '[^0-9]', ''), 10) = RIGHT(REGEXP_REPLACE(?, '[^0-9]', ''), 10)
          LIMIT 1`,
        [mobile]
      );
      if (dup) {
        return NextResponse.json(
          { message: `A worker with this mobile number already exists: ${dup.name} (ID ${dup.id}).` },
          { status: 409 }
        );
      }
    }

    const res = await query(
      `INSERT INTO workers (name, mobile, photo_url, address, zone_id, lok_sabha_id, district_id, assembly_id, ward_id, booth_id, position, skills, status, activity_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.name, mobile, d.photo_url || null, d.address || null,
       d.zone_id || null, d.lok_sabha_id || null, d.district_id || null, d.assembly_id || null,
       d.ward_id || null, d.booth_id || null, d.position || null, d.skills || null,
       d.status === "inactive" ? "inactive" : "active", Number(d.activity_score) || 0]
    );

    // Also add the worker to the calling pipeline (contacts) if they have a phone.
    // Deduped on phone_number (UNIQUE); a duplicate is fine — don't fail the worker.
    let addedToContacts = false;
    if (mobile) {
      try {
        await query(
          `INSERT INTO contacts (person_name, phone_number, address, district_id, assembly_id, ward_id, booth_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [d.name, mobile, d.address || null, d.district_id || null, d.assembly_id || null,
           d.ward_id || null, d.booth_id || null]
        );
        addedToContacts = true;
      } catch (e) {
        if (e.code !== "ER_DUP_ENTRY") throw e; // already a contact → ignore
      }
    }

    return NextResponse.json({ id: res.insertId, addedToContacts }, { status: 201 });
  } catch (err) {
    console.error("workers POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
