import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSupervisorRole } from "@/lib/permissions";
import { query } from "@/lib/db";
import { supervisorCallerScopeFilter } from "@/lib/supervisorScope";

// GET /api/supervisor/contacts/callers — caller accounts within this
// supervisor's own territory only. Never leaks callers belonging to other
// supervisors/districts, unlike GET /api/users (which returns every user).
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisorRole(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    // A configured supervisor gets callers in their territory; an unconfigured
    // one gets all callers (full oversight) — supervisorCallerScopeFilter
    // returns an empty clause in that case.
    const scope = supervisorCallerScopeFilter(session.user, "u");
    const users = await query(
      `SELECT u.id, u.username, u.role, u.home_district_id, l.name AS home_district_name
         FROM users u
         LEFT JOIN locations l ON l.id = u.home_district_id
        WHERE u.role IN ('caller', 'user', 'agent') ${scope.where}
        ORDER BY u.username`,
      scope.params
    );
    return NextResponse.json({ users });
  } catch (err) {
    console.error("supervisor callers GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
