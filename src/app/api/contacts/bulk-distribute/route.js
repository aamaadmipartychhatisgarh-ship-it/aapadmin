import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, normalizeRole, ROLES, scopeFilterSync } from "@/lib/permissions";
import { query, getPool } from "@/lib/db";
import { contactsHaveAssignedAt, contactsHaveAssignedBy } from "@/lib/assignmentRules";
import { buildContactPersonFilter } from "@/lib/contactFilter";
import { statusWhere } from "@/lib/contactStatus";
import { notWrongNumberClause } from "@/lib/contactExtras";
import { logAudit } from "@/lib/audit";
import { emitLiveEvent, LIVE_EVENTS } from "@/lib/liveEvents";

// UPDATE ... WHERE id IN (...) is chunked at this size so one caller taking
// thousands of contacts never builds a single enormous IN() list.
const UPDATE_CHUNK_SIZE = 1000;

// Distribute contacts across MULTIPLE callers — either every contact
// matching the given filters, or an EXPLICIT set of contact ids (bulk
// checkbox selection on the Contacts page).
//
// Body: {
//   caller_ids: number[],            // callers to share the work
//   mode: "even" | "perCaller",      // even split, or a fixed number each
//   per_caller?: number,             // required when mode = "perCaller"
//   contact_ids?: number[],          // explicit selection — when given, this
//                                     // IS the target set; status/geo/search
//                                     // filters below are ignored (the user
//                                     // already picked exactly who)
//   status?, district_id?, search?   // same filters as the contacts list —
//                                     // only used when contact_ids is absent
// }
//
// Either way, the wrong-number exclusion, the `reassign` gate, and the
// caller's geographic scope always apply — an explicit id list is never
// trusted blindly, only ever narrowed further by those. Pulls in id order
// (or oldest-held-first when not reassigning). Round-robin so any remainder
// is spread.
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

    // Explicit checkbox selection takes over targeting entirely — status/geo/
    // designation/search filters are meaningless once the user has already
    // picked exact contacts, so they're skipped rather than ANDed in (which
    // would silently drop selected rows that fall outside whatever filter
    // happens to still be active in the UI).
    const explicitIds = Array.isArray(body.contact_ids)
      ? [...new Set(body.contact_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
      : [];

    let where = " WHERE 1=1";
    const params = [];
    let workerJoin = "";
    const status = body.status;
    if (explicitIds.length > 0) {
      const ph = explicitIds.map(() => "?").join(",");
      where += ` AND c.id IN (${ph})`;
      params.push(...explicitIds);
    } else {
      // Build the same WHERE the list uses (src/app/api/contacts/route.js), so
      // Distribute acts on EXACTLY the set the admin is looking at when they
      // click it — not a silently narrower one. Previously this unconditionally
      // forced `is_completed = 0`, which dropped every "done" contact from the
      // batch regardless of the status filter actually selected: filtering to
      // "Done" and distributing matched zero rows, and filtering to "All" quietly
      // dropped the done ones from the count ("Selected 200, only some assigned").
      const statusCond = statusWhere(status);
      if (statusCond) where += ` AND ${statusCond}`;
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
      workerJoin = person.needsWorkerJoin ? "LEFT JOIN workers w ON w.id = c.worker_id" : "";
    }
    // Always applied, explicit selection or not: the calling engine must
    // NEVER assign a Wrong Number contact, `reassign=false` must never pull
    // from another caller's queue, and geographic scope is never bypassable.
    where += await notWrongNumberClause("c");
    if (!reassign) where += " AND c.assigned_to_user_id IS NULL";
    const scope = scopeFilterSync(session.user, "c");
    where += " " + scope.where;
    params.push(...scope.params);

    // How many to fetch. "even" mode takes every matching row (no cap); only
    // "perCaller" imposes a deliberate, admin-specified capacity.
    const capacity = mode === "perCaller" ? perCaller * callers.length : null;
    const limitSql = capacity ? " LIMIT " + capacity : "";
    const stampAssignedAt = await contactsHaveAssignedAt();
    const stampAssignedBy = await contactsHaveAssignedBy();

    let matchedTotal = 0;
    let assigned = 0;
    let dbUpdatedTotal = 0;
    const perCounts = {};
    const mismatches = [];

    // Everything below runs on ONE connection inside ONE transaction — the
    // match count, the id selection, and the update. Previously the count
    // and the id-select were two separate, unlocked pool.query() calls, so
    // anything that changed the matching rows in between (a caller finishing
    // a call, another admin distributing/recalling, a top-up) could shrink
    // the second read below the first count — "assigned" landing under
    // "matched_total" for no visible reason, by an amount that depended on
    // how much concurrent activity happened in that window. The id-select
    // below is a locking read (FOR UPDATE), so once we've picked the rows
    // no other transaction can touch them until we commit — no double-
    // assignment race between selection and the update either.
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();

      const [countRows] = await conn.query(
        `SELECT COUNT(*) AS matchedTotal FROM contacts c ${workerJoin} ${where}`,
        params
      );
      matchedTotal = Number(countRows[0].matchedTotal);

      // When reassigning, take the matching set straight by id (so contacts
      // held by other callers get moved). Otherwise hand out unassigned pool
      // first.
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

      // Round-robin the ids across callers.
      const buckets = new Map(callers.map((c) => [c.id, []]));
      idRows.forEach((row, i) => {
        const callerId = callers[i % callers.length].id;
        buckets.get(callerId).push(row.id);
      });

      // One bulk UPDATE per caller (id IN (...)), chunked so a single caller
      // taking thousands of contacts never builds one enormous IN() list.
      for (const c of callers) {
        const ids = buckets.get(c.id);
        perCounts[c.username] = ids.length;
        if (ids.length === 0) continue;
        for (let i = 0; i < ids.length; i += UPDATE_CHUNK_SIZE) {
          const chunk = ids.slice(i, i + UPDATE_CHUNK_SIZE);
          const ph = chunk.map(() => "?").join(",");
          // Clear any lock so a reassigned contact leaves the previous caller's
          // queue, and record WHO assigned it (for the caller's "Assigned by" line).
          const [result] = await conn.query(
            `UPDATE contacts SET assigned_to_user_id = ?${stampAssignedAt ? ", assigned_at = NOW()" : ""}${stampAssignedBy ? ", assigned_by_user_id = ?" : ""},
                    locked_by_user_id = NULL, locked_at = NULL WHERE id IN (${ph})`,
            stampAssignedBy ? [c.id, session.user.id, ...chunk] : [c.id, ...chunk]
          );
          // Verify the DB actually touched as many rows as we intended to move —
          // MySQL's affectedRows counts matched rows even when values are
          // unchanged (no ON DUPLICATE/IGNORE involved here), so this should
          // always equal chunk.length; if it ever doesn't, surface it instead
          // of silently trusting the intended count.
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

    if (mismatches.length) console.error("contacts bulk-distribute: affectedRows mismatch", mismatches);

    await logAudit(session, {
      action: "contacts.distribute",
      entityType: "contacts",
      details: {
        matched_total: matchedTotal,          // rows the filters matched, before any per-caller cap
        assigned,                             // rows we intended to update (sum of per-caller buckets)
        db_updated: dbUpdatedTotal,            // rows MySQL actually reports as affected
        per_caller_counts: perCounts,
        mode, per_caller: mode === "perCaller" ? perCaller : undefined,
        reassign, status: status || "all",
        explicit_selection: explicitIds.length > 0 ? explicitIds.length : undefined,
        mismatches: mismatches.length ? mismatches : undefined,
      },
    });
    if (assigned > 0) emitLiveEvent(LIVE_EVENTS.CONTACT_ASSIGNED, { count: assigned });
    return NextResponse.json({
      assigned,
      matched_total: matchedTotal,
      db_updated: dbUpdatedTotal,
      per_caller_counts: perCounts,
      failed: assigned - dbUpdatedTotal,
    });
  } catch (err) {
    console.error("contacts bulk-distribute error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
