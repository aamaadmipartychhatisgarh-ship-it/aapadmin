import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { loadUserScope, roleOf, OVERSIGHT_ROLES, ROLES } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureReportIndexes } from "@/lib/reports/ensureIndexes";
import { userCanAccessPageKey } from "@/lib/pageAccess";

// Shared by every Reports Center route (list/run/export/saved-filters):
// oversight OR a user the Super Admin has explicitly granted the "reports" page
// (BUG 14). Per-module access is refined inside the engine (some modules are
// super-admin only); data is geo-scoped to the caller's territory. A user
// admitted purely via grant is treated as supervisor-equivalent for module
// visibility (never super-admin-only modules) — returned as roleOverride — but
// their data scope still comes from their real role/territory.
export async function reportsGuard() {
  const session = await getServerSession(authOptions);
  if (!session) return { error: Response.json({ message: "Unauthorized" }, { status: 401 }) };
  const oversight = OVERSIGHT_ROLES.includes(roleOf(session));
  const granted = oversight ? false : await userCanAccessPageKey(session, "reports");
  if (!oversight && !granted) {
    return { error: Response.json({ message: "Forbidden" }, { status: 403 }) };
  }
  // One-time, background: make sure the report date columns are indexed so the
  // range/sort queries never full-scan (never blocks this request).
  ensureReportIndexes();
  await loadUserScope(session, query);
  return { session, roleOverride: granted ? ROLES.SUPERVISOR : undefined };
}
