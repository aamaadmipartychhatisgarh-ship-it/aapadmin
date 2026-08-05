import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSupervisorRole } from "@/lib/permissions";
import { query } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { supervisorScopeFilter, supervisorCallerScopeFilter } from "@/lib/supervisorScope";

// Supervisor-scoped mirror of POST /api/contacts/bulk-unassign. Body:
// { caller_ids?: number[] } — empty/omitted = recall from every caller IN
// THIS SUPERVISOR'S TERRITORY (never state-wide, unlike the admin route).
// Scoped on the contact's own geography (supervisorScopeFilter) so a
// contact can only ever be recalled if it's within the supervisor's
// territory, regardless of who it's currently assigned to.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisorRole(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const callerIds = Array.isArray(body.caller_ids) ? body.caller_ids.filter((n) => Number.isInteger(Number(n))) : [];

    let where = "c.assigned_to_user_id IS NOT NULL";
    const params = [];
    if (callerIds.length > 0) {
      // Re-verify every requested caller id is actually in this supervisor's
      // territory before honoring it — a tampered id list must not let a
      // supervisor probe/affect another supervisor's callers.
      const placeholders = callerIds.map(() => "?").join(",");
      const callerScope = supervisorCallerScopeFilter(session.user, "u");
      const validCallers = await query(
        `SELECT id FROM users u WHERE u.id IN (${placeholders}) ${callerScope.where}`,
        [...callerIds, ...callerScope.params]
      );
      const validIds = validCallers.map((r) => r.id);
      if (validIds.length === 0) {
        return NextResponse.json({ message: "None of the selected callers are in your territory." }, { status: 403 });
      }
      where += ` AND c.assigned_to_user_id IN (${validIds.map(() => "?").join(",")})`;
      params.push(...validIds);
    }
    const scope = supervisorScopeFilter(session.user, "c");
    where += " " + scope.where;
    params.push(...scope.params);

    const res = await query(
      `UPDATE contacts c
          SET assigned_to_user_id = NULL,
              is_completed = 0,
              locked_by_user_id = NULL,
              locked_at = NULL,
              follow_up_date = NULL
        WHERE ${where}`,
      params
    );
    await logAudit(session, {
      action: "contacts.unassign",
      entityType: "contacts",
      details: { unassigned: res.affectedRows, caller_ids: callerIds.length ? callerIds : "all_in_territory", supervisor: true },
    });
    return NextResponse.json({ unassigned: res.affectedRows });
  } catch (err) {
    console.error("supervisor bulk-unassign error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
