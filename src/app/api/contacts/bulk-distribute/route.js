import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, normalizeRole, ROLES, scopeFilterSync } from "@/lib/permissions";
import { query, getPool } from "@/lib/db";
import { contactsHaveAssignedAt, contactsHaveAssignedBy } from "@/lib/assignmentRules";
import { buildContactPersonFilter } from "@/lib/contactFilter";

// Distribute contacts matching the given filters across MULTIPLE callers.
//
// Body: {
//   caller_ids: number[],            // callers to share the work
//   mode: "even" | "perCaller",      // even split, or a fixed number each
//   per_caller?: number,             // required when mode = "perCaller"
//   status?, district_id?, search?   // same filters as the contacts list
// }
//
// Pulls from ALL matching contacts (except already-called Done ones), ordered
// so unassigned contacts go out first. Round-robin so any remainder is spread.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
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

    // Validate every target is actually a caller.
    const placeholders = callerIds.map(() => "?").join(",");
    const validRows = await query(
      `SELECT id, role, username FROM users WHERE id IN (${placeholders})`,
      callerIds
    );
    const callers = validRows.filter((u) => normalizeRole(u.role) === ROLES.CALLER);
    if (callers.length !== callerIds.length) {
      return NextResponse.json({ message: "One or more selected users are not callers." }, { status: 400 });
    }

    // reassign (default true): pull matching contacts off other callers too.
    // When false, only unassigned pool contacts are handed out.
    const reassign = body.reassign !== false;

    // Build the same WHERE the list/bulk-assign use.
    let where = " WHERE c.is_completed = 0"; // never touch already-called contacts
    const params = [];
    const status = body.status;
    // status already implies is_completed for pending/done; keep pool/assigned filters.
    if (status === "assigned") where += " AND c.assigned_to_user_id IS NOT NULL";
    if (status === "pool") where += " AND c.assigned_to_user_id IS NULL";
    if (!reassign) where += " AND c.assigned_to_user_id IS NULL";
    // Geo + designation via the SHARED person-aware filter, so Distribution acts
    // on exactly the same people the Contacts list and Add Workers page show.
    const idList = (v) => [...new Set(String(v ?? "").split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0))];
    const person = buildContactPersonFilter({
      zone_id: body.zone_id,
      lok_sabha_id: body.lok_sabha_id,
      district_id: body.district_id,
      assembly_ids: idList(body.assembly_ids ?? body.assembly_id),
      designation_ids: idList(body.designation_ids ?? body.designation_id),
    });
    where += person.where;
    params.push(...person.params);
    if (body.search) {
      where += " AND (c.person_name LIKE ? OR c.phone_number LIKE ?)";
      params.push(`%${body.search}%`, `%${body.search}%`);
    }
    const scope = scopeFilterSync(session.user, "c");
    where += " " + scope.where;
    params.push(...scope.params);
    const workerJoin = person.needsWorkerJoin ? "LEFT JOIN workers w ON w.id = c.worker_id" : "";

    // How many to fetch.
    const capacity = mode === "perCaller" ? perCaller * callers.length : null; // even = all matching
    const limitSql = capacity ? " LIMIT " + capacity : "";

    // When reassigning, take the matching set straight by id (so contacts held
    // by other callers get moved). Otherwise hand out unassigned pool first.
    const rows = await query(
      `SELECT c.id FROM contacts c ${workerJoin} ${where}
        ORDER BY ${reassign ? "c.id ASC" : "(c.assigned_to_user_id IS NOT NULL), c.id ASC"} ${limitSql}`,
      params
    );
    if (rows.length === 0) {
      return NextResponse.json({ assigned: 0, per_caller_counts: {} });
    }

    // Round-robin the ids across callers.
    const buckets = new Map(callers.map((c) => [c.id, []]));
    rows.forEach((row, i) => {
      const callerId = callers[i % callers.length].id;
      buckets.get(callerId).push(row.id);
    });

    // One bulk UPDATE per caller (id IN (...)) — no N+1, scales to 1000s of ids.
    // Wrapped in a single transaction so the whole distribution is atomic:
    // either every contact is (re)assigned or none is — never a partial result.
    const stampAssignedAt = await contactsHaveAssignedAt();
    const stampAssignedBy = await contactsHaveAssignedBy();
    let assigned = 0;
    const perCounts = {};
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      for (const c of callers) {
        const ids = buckets.get(c.id);
        perCounts[c.username] = ids.length;
        if (ids.length === 0) continue;
        const ph = ids.map(() => "?").join(",");
        // Clear any lock so a reassigned contact leaves the previous caller's queue,
        // and record WHO assigned it (for the caller's "Assigned by" line).
        await conn.query(
          `UPDATE contacts SET assigned_to_user_id = ?${stampAssignedAt ? ", assigned_at = NOW()" : ""}${stampAssignedBy ? ", assigned_by_user_id = ?" : ""},
                  locked_by_user_id = NULL, locked_at = NULL WHERE id IN (${ph})`,
          stampAssignedBy ? [c.id, session.user.id, ...ids] : [c.id, ...ids]
        );
        assigned += ids.length;
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    return NextResponse.json({ assigned, per_caller_counts: perCounts });
  } catch (err) {
    console.error("contacts bulk-distribute error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
