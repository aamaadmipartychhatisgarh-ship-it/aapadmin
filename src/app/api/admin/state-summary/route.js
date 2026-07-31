import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, scopeFilterSync } from "@/lib/permissions";
import { buildOverviewSummary } from "@/lib/overviewSummary";

// State Overview — the same shape as /api/supervisor/summary, but aggregated at
// the state level (all callers). Zone/district/assembly admins are scoped to
// their territory; a super/state admin sees everything. The UI is shared with
// the Supervisor Overview — only the data source (this scope) differs.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const scope = scopeFilterSync(session.user, "c"); // { where: " AND …", params } or empty
    const summary = await buildOverviewSummary({
      date_from: searchParams.get("date_from"),
      date_to: searchParams.get("date_to"),
      scope,
      includeTeams: true, // Media + Social team snapshots on the admin dashboard
    });
    return NextResponse.json(summary);
  } catch (err) {
    console.error("admin/state-summary error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
