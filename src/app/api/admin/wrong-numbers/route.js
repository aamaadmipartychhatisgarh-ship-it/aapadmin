import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, scopeFilterSync } from "@/lib/permissions";
import { query } from "@/lib/db";
import { hasWrongNumberColumn } from "@/lib/contactExtras";

export const dynamic = "force-dynamic";

// GET /api/admin/wrong-numbers — the dedicated Wrong Numbers module list.
// Supervisor / Team Leader / Super Admin (+ scoped admins) only.
// Filters: search, zone_id, lok_sabha_id, district_id, assembly_id, caller,
// date_from/date_to (on the date the number was marked wrong), status.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasWrongNumberColumn())) {
      return NextResponse.json({ wrong_numbers: [] });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search");
    const zoneId = searchParams.get("zone_id");
    const lokSabhaId = searchParams.get("lok_sabha_id");
    const districtId = searchParams.get("district_id");
    const assemblyId = searchParams.get("assembly_id");
    const caller = searchParams.get("caller");
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");
    const statusF = searchParams.get("status"); // assigned | unassigned

    const where = ["c.is_wrong_number = 1"];
    const params = [];
    if (search) { where.push("(c.person_name LIKE ? OR c.phone_number LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
    if (zoneId) { where.push("c.zone_id = ?"); params.push(zoneId); }
    if (lokSabhaId) { where.push("c.lok_sabha_id = ?"); params.push(lokSabhaId); }
    if (districtId) { where.push("c.district_id = ?"); params.push(districtId); }
    if (assemblyId) { where.push("c.assembly_id = ?"); params.push(assemblyId); }
    if (caller) { where.push("c.assigned_to_user_id = ?"); params.push(caller); }
    if (statusF === "assigned") where.push("c.assigned_to_user_id IS NOT NULL");
    if (statusF === "unassigned") where.push("c.assigned_to_user_id IS NULL");

    // Geographic scope from role (super_admin / state / supervisor see all).
    const scope = scopeFilterSync(session.user, "c");
    if (scope.where) { where.push(scope.where.replace(/^AND /, "")); params.push(...scope.params); }

    // Date range applies to when the contact was marked a wrong number. Applied
    // on the derived column via an outer WHERE (a wrapper subquery) so it stays a
    // simple row filter.
    const outer = [];
    const outerParams = [];
    if (dateFrom) { outer.push("DATE(t.marked_wrong_date) >= ?"); outerParams.push(dateFrom); }
    if (dateTo) { outer.push("DATE(t.marked_wrong_date) <= ?"); outerParams.push(dateTo); }
    const outerWhere = outer.length ? `WHERE ${outer.join(" AND ")}` : "";

    const rows = await query(
      `SELECT * FROM (
        SELECT c.id, c.person_name, c.phone_number, c.address, c.assigned_to_user_id,
              u.username AS caller_name,
              lz.name AS zone_name, lls.name AS lok_sabha_name, ld.name AS district_name,
              la.name AS assembly_name, lw.name AS ward_name,
              w.photo_url AS photo_url,
              (SELECT COUNT(*) FROM calls x WHERE x.contact_id = c.id) AS attempts,
              (SELECT MAX(x.called_at) FROM calls x WHERE x.contact_id = c.id) AS last_call_date,
              (SELECT MAX(x.called_at) FROM calls x JOIN call_statuses cs ON cs.id = x.status_id
                 WHERE x.contact_id = c.id AND cs.name = 'Wrong Number') AS marked_wrong_date,
              (SELECT x.remarks FROM calls x WHERE x.contact_id = c.id ORDER BY x.called_at DESC, x.id DESC LIMIT 1) AS last_remarks
         FROM contacts c
         LEFT JOIN users u ON u.id = c.assigned_to_user_id
         LEFT JOIN workers w ON w.id = c.worker_id
         LEFT JOIN locations lz ON lz.id = c.zone_id
         LEFT JOIN locations lls ON lls.id = c.lok_sabha_id
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations la ON la.id = c.assembly_id
         LEFT JOIN locations lw ON lw.id = c.ward_id
        WHERE ${where.join(" AND ")}
      ) t
      ${outerWhere}
      ORDER BY t.marked_wrong_date DESC, t.id DESC
      LIMIT 2000`,
      [...params, ...outerParams]
    );

    return NextResponse.json({ wrong_numbers: rows, total: rows.length });
  } catch (err) {
    console.error("wrong-numbers GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
