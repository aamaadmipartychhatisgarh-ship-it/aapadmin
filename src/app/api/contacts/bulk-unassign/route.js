import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query, getPool } from "@/lib/db";
import { buildContactPersonFilter } from "@/lib/contactFilter";
import { statusWhere } from "@/lib/contactStatus";
import { logAudit } from "@/lib/audit";

// POST /api/contacts/bulk-unassign
// Return ONLY the matching assigned contacts to the pool — never a caller's whole
// assignment unless nothing narrows it. It respects the SAME scope the list uses:
//   • contact_ids      → recall exactly those contacts (explicit selection wins)
//   • caller_ids       → limit to these callers' contacts
//   • assigned_to      → limit to this caller's contacts (the list's caller filter)
//   • designation_ids / zone_id / lok_sabha_id / district_id / assembly_ids
//   • status / search
// So "designation = X for caller A" recalls ONLY A's X contacts (BUG #10), leaving
// every other designation and every other caller untouched. Contacts are NOT
// deleted; call history is untouched. Targeted by id inside a transaction so a
// partial failure can't corrupt assignments.
const CHUNK = 1000;
const idList = (v) => [...new Set(String(v ?? "").split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0))];

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    // Part of the Contacts page — admin role OR a "contacts" Page-Access grant.
    if (!(await pageAllowed(session, "contacts", session && isAdmin(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));

    const callerIds = Array.isArray(body.caller_ids) ? body.caller_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    if (body.assigned_to != null && /^\d+$/.test(String(body.assigned_to))) callerIds.push(Number(body.assigned_to));
    const callers = [...new Set(callerIds)];

    const explicitIds = Array.isArray(body.contact_ids)
      ? [...new Set(body.contact_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
      : [];

    // Base: only currently-assigned contacts are ever affected.
    let where = " WHERE c.assigned_to_user_id IS NOT NULL";
    const params = [];
    let workerJoin = "";
    if (explicitIds.length > 0) {
      // Explicit selection is the exact set — no other filter widens it, but the
      // assigned-only base still guards against recalling an already-pooled row.
      where += ` AND c.id IN (${explicitIds.map(() => "?").join(",")})`;
      params.push(...explicitIds);
      if (callers.length) { where += ` AND c.assigned_to_user_id IN (${callers.map(() => "?").join(",")})`; params.push(...callers); }
    } else {
      if (callers.length) { where += ` AND c.assigned_to_user_id IN (${callers.map(() => "?").join(",")})`; params.push(...callers); }
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

    const conn = await getPool().getConnection();
    let unassigned = 0;
    try {
      await conn.beginTransaction();
      // Lock exactly the matching rows, then update them by id — so only the
      // selected/matching contacts move, never the caller's whole assignment.
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
      details: {
        unassigned, caller_ids: callers.length ? callers : "all",
        explicit_selection: explicitIds.length || undefined,
        designation_ids: idList(body.designation_ids ?? body.designation_id).length || undefined,
      },
    });
    return NextResponse.json({ unassigned });
  } catch (err) {
    console.error("bulk-unassign error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
