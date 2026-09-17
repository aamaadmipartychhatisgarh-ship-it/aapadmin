import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { scopeFilterSync } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { notWrongNumberClause } from "@/lib/contactExtras";

// GET /api/contacts/active-workers
// User-wise Active Workers = contacts ASSIGNED to a caller and still active
// (assigned_to_user_id IS NOT NULL, and NOT a wrong number — the same
// "reachable" definition the Contacts list uses), grouped by the caller.
// A single backend GROUP BY, so the counts reflect the COMPLETE authorized
// dataset (never a paginated subset) and honour the caller's role/territory
// scope and Page Access exactly like the Contacts list.
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "contacts", session && isSupervisor(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const search = (searchParams.get("search") || "").trim();
    const district_id = searchParams.get("district_id");
    const assembly_id = searchParams.get("assembly_id");

    let where = " WHERE c.assigned_to_user_id IS NOT NULL";
    const params = [];
    // "Active" excludes wrong-number contacts — identical rule to the list.
    where += await notWrongNumberClause("c");
    if (district_id) { where += " AND c.district_id = ?"; params.push(district_id); }
    if (assembly_id) { where += " AND c.assembly_id = ?"; params.push(assembly_id); }
    if (search) { where += " AND u.username LIKE ?"; params.push(`%${search}%`); }
    // Same non-bypassable geographic/role scope the Contacts list applies.
    const scope = scopeFilterSync(session.user, "c");
    where += " " + scope.where;
    params.push(...scope.params);

    const rows = await query(
      `SELECT c.assigned_to_user_id AS user_id, u.username,
              COUNT(*) AS active_count,
              COALESCE(SUM(c.is_completed = 1), 0) AS done_count,
              COALESCE(SUM(c.is_completed = 0), 0) AS pending_count
         FROM contacts c
         JOIN users u ON u.id = c.assigned_to_user_id
        ${where}
        GROUP BY c.assigned_to_user_id, u.username
        ORDER BY active_count DESC, u.username ASC`,
      params
    );

    const groups = rows.map((r) => ({
      user_id: r.user_id,
      username: r.username,
      active_count: Number(r.active_count) || 0,
      done_count: Number(r.done_count) || 0,
      pending_count: Number(r.pending_count) || 0,
    }));
    const total = groups.reduce((a, g) => a + g.active_count, 0);
    return NextResponse.json({ groups, total, callers: groups.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("active-workers GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
