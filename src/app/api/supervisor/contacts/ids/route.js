import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSupervisorRole } from "@/lib/permissions";
import { query } from "@/lib/db";
import { buildContactPersonFilter } from "@/lib/contactFilter";
import { statusWhere } from "@/lib/contactStatus";
import { notWrongNumberClause } from "@/lib/contactExtras";
import { supervisorScopeFilter } from "@/lib/supervisorScope";

// Supervisor-scoped mirror of GET /api/contacts/ids — every contact id
// matching the current filters, WITHIN this supervisor's territory, uncapped
// (no pagination limit). Powers "Select all N matching filters."
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
    const scope = supervisorScopeFilter(session.user, "c");
    where += " " + scope.where;
    params.push(...scope.params);

    const workerJoin = "LEFT JOIN workers w ON w.id = c.worker_id";
    const rows = await query(`SELECT c.id FROM contacts c ${workerJoin} ${where}`, params);
    return NextResponse.json({ ids: rows.map((r) => r.id) });
  } catch (err) {
    console.error("supervisor contacts ids GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
