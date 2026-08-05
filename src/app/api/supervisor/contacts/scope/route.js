import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSupervisorRole } from "@/lib/permissions";
import { query } from "@/lib/db";
import { supervisorHasScope, supervisorTerritory } from "@/lib/supervisorScope";

// GET /api/supervisor/contacts/scope — resolves the signed-in Supervisor's
// own territory (zone/lok sabha/district/assembly), for the page banner and
// to pre-lock the filter dropdowns at/above the supervisor's anchor level.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisorRole(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const hasScope = supervisorHasScope(session.user);
    const territory = hasScope ? await supervisorTerritory(session.user, query) : null;
    return NextResponse.json({ has_scope: hasScope, territory });
  } catch (err) {
    console.error("supervisor contacts scope error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
