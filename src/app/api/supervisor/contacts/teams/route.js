import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSupervisorRole } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureUserTeamMembers } from "@/lib/teamSchema";
import { supervisorCallerScopeFilter, supervisorHasScope } from "@/lib/supervisorScope";

// GET /api/supervisor/contacts/teams — teams that contain at least one
// caller within this supervisor's territory (there's no direct
// supervisor<->team link in the schema, so "this is my team" is defined by
// "this team has callers I'm allowed to see" — see src/lib/supervisorScope.js).
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisorRole(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (!supervisorHasScope(session.user)) {
      return NextResponse.json({ teams: [] });
    }
    await ensureUserTeamMembers();
    // Same scope clause, computed once per alias — params must be passed in
    // the exact order their placeholders appear in the SQL text below (the
    // u2 subquery comes first, then the outer WHERE EXISTS on u).
    const scopeU2 = supervisorCallerScopeFilter(session.user, "u2");
    const scopeU = supervisorCallerScopeFilter(session.user, "u");
    const teams = await query(
      `SELECT t.id, t.name, t.level, t.location_id, l.name AS location_name,
              (SELECT COUNT(*) FROM team_members tm2
                 JOIN users u2 ON u2.id = tm2.user_id
                WHERE tm2.team_id = t.id AND u2.role IN ('caller','user','agent') ${scopeU2.where}
              ) AS in_territory_caller_count
         FROM teams t
         LEFT JOIN locations l ON l.id = t.location_id
        WHERE EXISTS (
          SELECT 1 FROM team_members tm
            JOIN users u ON u.id = tm.user_id
           WHERE tm.team_id = t.id AND u.role IN ('caller','user','agent') ${scopeU.where}
        )
        ORDER BY t.name`,
      [...scopeU2.params, ...scopeU.params]
    );
    return NextResponse.json({ teams });
  } catch (err) {
    console.error("supervisor teams GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
