import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSupervisorRole, normalizeRole, ROLES } from "@/lib/permissions";
import { query, getPool } from "@/lib/db";
import { contactsHaveAssignedAt, contactsHaveAssignedBy } from "@/lib/assignmentRules";
import { buildContactPersonFilter } from "@/lib/contactFilter";
import { statusWhere } from "@/lib/contactStatus";
import { notWrongNumberClause } from "@/lib/contactExtras";
import { logAudit } from "@/lib/audit";
import { emitLiveEvent, LIVE_EVENTS } from "@/lib/liveEvents";
import { supervisorScopeFilter, supervisorCallerScopeFilter } from "@/lib/supervisorScope";

// Supervisor-scoped mirror of POST /api/contacts/bulk-distribute. Two layers
// of enforcement, both server-side (never trust the client's caller_ids or
// filters): the contact selection is scoped via supervisorScopeFilter, and
// every target caller_id is independently verified to be a caller WITHIN
// this supervisor's territory via supervisorCallerScopeFilter — so a
// tampered request naming an out-of-territory caller id is rejected outright
// rather than silently handing them contacts.
const UPDATE_CHUNK_SIZE = 1000;

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisorRole(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const callerIds = Array.isArray(body.caller_ids) ? body.caller_ids.map(Number).filter(Boolean) : [];
    const mode = body.mode === "perCaller" ? "perCaller" : "even";
    const perCaller = Math.max(0, Number(body.per_caller) || 0);

    if (callerIds.length === 0) {
      return NextResponse.json({ message: "Select at least one caller." }, { status: 400 });
    }
    if (mode === "perCaller" && perCaller <= 0) {
      return NextResponse.json({ message: "Enter how many contacts per caller." }, { status: 400 });
    }

    // Validate every target is a caller AND within this supervisor's territory.
    const placeholders = callerIds.map(() => "?").join(",");
    const callerScope = supervisorCallerScopeFilter(session.user, "u");
    const validRows = await query(
      `SELECT id, role, username FROM users u WHERE u.id IN (${placeholders}) ${callerScope.where}`,
      [...callerIds, ...callerScope.params]
    );
    const callers = validRows.filter((u) => normalizeRole(u.role) === ROLES.CALLER);
    if (callers.length !== callerIds.length) {
      return NextResponse.json({ message: "One or more selected callers are not in your territory." }, { status: 403 });
    }

    const reassign = body.reassign !== false;

    let where = " WHERE 1=1";
    const params = [];
    const status = body.status;
    const statusCond = statusWhere(status);
    if (statusCond) where += ` AND ${statusCond}`;
    where += await notWrongNumberClause("c");
    if (!reassign) where += " AND c.assigned_to_user_id IS NULL";
    const idListFn = (v) => [...new Set(String(v ?? "").split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0))];
    const person = buildContactPersonFilter({
      zone_id: body.zone_id,
      lok_sabha_id: body.lok_sabha_id,
      district_id: body.district_id,
      assembly_ids: idListFn(body.assembly_ids ?? body.assembly_id),
      designation_ids: idListFn(body.designation_ids ?? body.designation_id),
    });
    where += person.where;
    params.push(...person.params);
    if (body.search) {
      where += " AND (c.person_name LIKE ? OR c.phone_number LIKE ?)";
      params.push(`%${body.search}%`, `%${body.search}%`);
    }
    // Strict territory scope — the contact set this supervisor may ever touch.
    const scope = supervisorScopeFilter(session.user, "c");
    where += " " + scope.where;
    params.push(...scope.params);
    const workerJoin = "LEFT JOIN workers w ON w.id = c.worker_id";

    const capacity = mode === "perCaller" ? perCaller * callers.length : null;
    const limitSql = capacity ? " LIMIT " + capacity : "";
    const stampAssignedAt = await contactsHaveAssignedAt();
    const stampAssignedBy = await contactsHaveAssignedBy();

    let matchedTotal = 0;
    let assigned = 0;
    let dbUpdatedTotal = 0;
    const perCounts = {};
    const mismatches = [];

    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();

      const [countRows] = await conn.query(
        `SELECT COUNT(*) AS matchedTotal FROM contacts c ${workerJoin} ${where}`,
        params
      );
      matchedTotal = Number(countRows[0].matchedTotal);

      const [idRows] = await conn.query(
        `SELECT c.id FROM contacts c ${workerJoin} ${where}
          ORDER BY ${reassign ? "c.id ASC" : "(c.assigned_to_user_id IS NOT NULL), c.id ASC"} ${limitSql}
          FOR UPDATE`,
        params
      );

      if (idRows.length === 0) {
        await conn.commit();
        return NextResponse.json({ assigned: 0, matched_total: matchedTotal, per_caller_counts: {} });
      }

      const buckets = new Map(callers.map((c) => [c.id, []]));
      idRows.forEach((row, i) => {
        const callerId = callers[i % callers.length].id;
        buckets.get(callerId).push(row.id);
      });

      for (const c of callers) {
        const ids = buckets.get(c.id);
        perCounts[c.username] = ids.length;
        if (ids.length === 0) continue;
        for (let i = 0; i < ids.length; i += UPDATE_CHUNK_SIZE) {
          const chunk = ids.slice(i, i + UPDATE_CHUNK_SIZE);
          const ph = chunk.map(() => "?").join(",");
          const [result] = await conn.query(
            `UPDATE contacts SET assigned_to_user_id = ?${stampAssignedAt ? ", assigned_at = NOW()" : ""}${stampAssignedBy ? ", assigned_by_user_id = ?" : ""},
                    locked_by_user_id = NULL, locked_at = NULL WHERE id IN (${ph})`,
            stampAssignedBy ? [c.id, session.user.id, ...chunk] : [c.id, ...chunk]
          );
          if (result.affectedRows !== chunk.length) {
            mismatches.push({ caller: c.username, intended: chunk.length, dbAffected: result.affectedRows, ids: chunk });
          }
          dbUpdatedTotal += result.affectedRows;
        }
        assigned += ids.length;
      }

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    if (mismatches.length) console.error("supervisor bulk-distribute: affectedRows mismatch", mismatches);

    await logAudit(session, {
      action: "contacts.distribute",
      entityType: "contacts",
      details: {
        matched_total: matchedTotal, assigned, db_updated: dbUpdatedTotal,
        per_caller_counts: perCounts, mode, per_caller: mode === "perCaller" ? perCaller : undefined,
        reassign, status: status || "all", supervisor: true,
        mismatches: mismatches.length ? mismatches : undefined,
      },
    });
    if (assigned > 0) emitLiveEvent(LIVE_EVENTS.CONTACT_ASSIGNED, { count: assigned });
    return NextResponse.json({
      assigned, matched_total: matchedTotal, db_updated: dbUpdatedTotal,
      per_caller_counts: perCounts, failed: assigned - dbUpdatedTotal,
    });
  } catch (err) {
    console.error("supervisor bulk-distribute error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
