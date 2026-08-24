import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSupervisorRole } from "@/lib/permissions";
import { query, getPool } from "@/lib/db";
import { buildContactPersonFilter } from "@/lib/contactFilter";
import { statusWhere } from "@/lib/contactStatus";
import { logAudit } from "@/lib/audit";
import { supervisorScopeFilter, supervisorCallerScopeFilter } from "@/lib/supervisorScope";

// Supervisor-scoped mirror of POST /api/contacts/bulk-unassign. Returns ONLY the
// matching assigned contacts to the pool — respecting the same list scope
// (contact_ids | caller_ids | assigned_to | designation/geo | status | search) —
// so recalling "designation X for caller A" removes only A's X contacts (BUG #10),
// never the caller's whole assignment. Always additionally bounded to THIS
// supervisor's territory. Targeted by id inside a transaction.
const CHUNK = 1000;
const idList = (v) => [...new Set(String(v ?? "").split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0))];

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisorRole(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));

    const rawCallers = Array.isArray(body.caller_ids) ? body.caller_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    if (body.assigned_to != null && /^\d+$/.test(String(body.assigned_to))) rawCallers.push(Number(body.assigned_to));
    const wanted = [...new Set(rawCallers)];

    let validIds = [];
    if (wanted.length > 0) {
      // Every requested caller must be in this supervisor's territory.
      const callerScope = supervisorCallerScopeFilter(session.user, "u");
      const rows = await query(
        `SELECT id FROM users u WHERE u.id IN (${wanted.map(() => "?").join(",")}) ${callerScope.where}`,
        [...wanted, ...callerScope.params]
      );
      validIds = rows.map((r) => r.id);
      if (validIds.length === 0) {
        return NextResponse.json({ message: "None of the selected callers are in your territory." }, { status: 403 });
      }
    }

    const explicitIds = Array.isArray(body.contact_ids)
      ? [...new Set(body.contact_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
      : [];

    let where = " WHERE c.assigned_to_user_id IS NOT NULL";
    const params = [];
    let workerJoin = "";
    if (explicitIds.length > 0) {
      where += ` AND c.id IN (${explicitIds.map(() => "?").join(",")})`;
      params.push(...explicitIds);
      if (validIds.length) { where += ` AND c.assigned_to_user_id IN (${validIds.map(() => "?").join(",")})`; params.push(...validIds); }
    } else {
      if (validIds.length) { where += ` AND c.assigned_to_user_id IN (${validIds.map(() => "?").join(",")})`; params.push(...validIds); }
      const statusCond = statusWhere(body.status);
      if (statusCond) where += ` AND ${statusCond}`;
      const person = buildContactPersonFilter({
        zone_id: body.zone_id,
        lok_sabha_id: body.lok_sabha_id,
        district_id: body.district_id,
        assembly_ids: idList(body.assembly_ids ?? body.assembly_id),
        designation_ids: idList(body.designation_ids ?? body.designation_id),
      });
      where += person.where;
      params.push(...person.params);
      if (person.needsWorkerJoin) workerJoin = "LEFT JOIN workers w ON w.id = c.worker_id";
      if (body.search) {
        where += " AND (c.person_name LIKE ? OR c.phone_number LIKE ?)";
        params.push(`%${body.search}%`, `%${body.search}%`);
      }
    }
    // Always bound to this supervisor's territory (contact's own geography).
    const scope = supervisorScopeFilter(session.user, "c");
    where += " " + scope.where;
    params.push(...scope.params);

    const conn = await getPool().getConnection();
    let unassigned = 0;
    try {
      await conn.beginTransaction();
      const [idRows] = await conn.query(`SELECT c.id FROM contacts c ${workerJoin} ${where} FOR UPDATE`, params);
      const ids = idRows.map((r) => r.id);
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const [res] = await conn.query(
          `UPDATE contacts SET assigned_to_user_id = NULL, is_completed = 0,
                  locked_by_user_id = NULL, locked_at = NULL, follow_up_date = NULL
            WHERE id IN (${chunk.map(() => "?").join(",")})`,
          chunk
        );
        unassigned += res.affectedRows;
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    await logAudit(session, {
      action: "contacts.unassign", entityType: "contacts",
      details: { unassigned, caller_ids: validIds.length ? validIds : "all_in_territory", supervisor: true, explicit_selection: explicitIds.length || undefined },
    });
    return NextResponse.json({ unassigned });
  } catch (err) {
    console.error("supervisor bulk-unassign error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
