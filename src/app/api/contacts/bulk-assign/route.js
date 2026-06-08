import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, normalizeRole, ROLES, scopeFilterSync } from "@/lib/permissions";
import { query } from "@/lib/db";

// Bulk-assign ALL contacts matching the given filters to one caller (or to the
// pool when caller is null). Mirrors the filters used by GET /api/contacts so
// "assign all matching" lines up with what the admin sees in the list.
//
// Body: { assigned_to_user_id, status?, district_id?, search? }
//   status: all | pending | done | assigned | pool
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const callerId = body.assigned_to_user_id || null;

    // Validate the target is actually a caller (when assigning, not un-assigning).
    if (callerId) {
      const rows = await query("SELECT id, role FROM users WHERE id = ?", [callerId]);
      const target = rows[0];
      if (!target || normalizeRole(target.role) !== ROLES.CALLER) {
        return NextResponse.json({ message: "Target user is not a caller." }, { status: 400 });
      }
    }

    // Build the SAME where-clause the list uses.
    let where = " WHERE 1=1";
    const params = [];
    const status = body.status;
    if (status === "pending") where += " AND c.is_completed = 0";
    if (status === "done") where += " AND c.is_completed = 1";
    if (status === "assigned") where += " AND c.assigned_to_user_id IS NOT NULL";
    if (status === "pool") where += " AND c.assigned_to_user_id IS NULL";
    if (body.district_id) { where += " AND c.district_id = ?"; params.push(body.district_id); }
    if (body.search) {
      where += " AND (c.person_name LIKE ? OR c.phone_number LIKE ?)";
      params.push(`%${body.search}%`, `%${body.search}%`);
    }
    // Apply the admin's geographic scope so they can only assign within their area.
    const scope = scopeFilterSync(session.user, "c");
    where += " " + scope.where;
    params.push(...scope.params);

    // Don't reassign contacts already marked done (they've been called).
    const safeWhere = where + " AND c.is_completed = 0";

    const res = await query(
      `UPDATE contacts c SET c.assigned_to_user_id = ? ${safeWhere}`,
      [callerId, ...params]
    );

    return NextResponse.json({ assigned: res.affectedRows ?? 0 });
  } catch (err) {
    console.error("contacts bulk-assign error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
