import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, normalizeRole, ROLES, scopeFilterSync } from "@/lib/permissions";
import { query } from "@/lib/db";

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

    // Build the same WHERE the list/bulk-assign use.
    let where = " WHERE c.is_completed = 0"; // never touch already-called contacts
    const params = [];
    const status = body.status;
    // status already implies is_completed for pending/done; keep pool/assigned filters.
    if (status === "assigned") where += " AND c.assigned_to_user_id IS NOT NULL";
    if (status === "pool") where += " AND c.assigned_to_user_id IS NULL";
    if (body.district_id) { where += " AND c.district_id = ?"; params.push(body.district_id); }
    if (body.designation_id) { where += " AND c.designation_id = ?"; params.push(body.designation_id); }
    if (body.search) {
      where += " AND (c.person_name LIKE ? OR c.phone_number LIKE ?)";
      params.push(`%${body.search}%`, `%${body.search}%`);
    }
    const scope = scopeFilterSync(session.user, "c");
    where += " " + scope.where;
    params.push(...scope.params);

    // How many to fetch.
    const capacity = mode === "perCaller" ? perCaller * callers.length : null; // even = all matching
    const limitSql = capacity ? " LIMIT " + capacity : "";

    // Unassigned first so we hand out fresh work before reshuffling assigned ones.
    const rows = await query(
      `SELECT c.id FROM contacts c ${where}
        ORDER BY (c.assigned_to_user_id IS NOT NULL), c.id ASC ${limitSql}`,
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

    // One UPDATE per caller (bulk by id list).
    let assigned = 0;
    const perCounts = {};
    for (const c of callers) {
      const ids = buckets.get(c.id);
      perCounts[c.username] = ids.length;
      if (ids.length === 0) continue;
      const ph = ids.map(() => "?").join(",");
      await query(
        `UPDATE contacts SET assigned_to_user_id = ? WHERE id IN (${ph})`,
        [c.id, ...ids]
      );
      assigned += ids.length;
    }

    return NextResponse.json({ assigned, per_caller_counts: perCounts });
  } catch (err) {
    console.error("contacts bulk-distribute error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
