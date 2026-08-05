import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSupervisorRole } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureUserTeamMembers } from "@/lib/teamSchema";
import { supervisorCallerScopeFilter } from "@/lib/supervisorScope";

// GET /api/supervisor/contacts/teams/[id] — a team's caller members,
// filtered to only those within this supervisor's territory (used to
// pre-select the caller chips when a supervisor picks "assign from team").
export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisorRole(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    await ensureUserTeamMembers();
    const { id } = await params;
    const scope = supervisorCallerScopeFilter(session.user, "u");
    const members = await query(
      `SELECT u.id AS user_id, u.username AS name, u.role AS user_role, 'user' AS member_type
         FROM team_members tm
         JOIN users u ON u.id = tm.user_id
        WHERE tm.team_id = ? AND u.role IN ('caller', 'user', 'agent') ${scope.where}
        ORDER BY u.username`,
      [id, ...scope.params]
    );
    return NextResponse.json({ members });
  } catch (err) {
    console.error("supervisor team members GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
