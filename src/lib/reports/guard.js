import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { loadUserScope, roleOf, OVERSIGHT_ROLES, ROLES } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureReportIndexes } from "@/lib/reports/ensureIndexes";
import { userCanAccessPageKey, isPageRestricted } from "@/lib/pageAccess";

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
  // A page-restricted user's role is ignored — only an explicit "reports"
  // assignment admits them; a non-restricted user uses the normal oversight rule.
  const restricted = await isPageRestricted(session);
  const oversight = !restricted && OVERSIGHT_ROLES.includes(roleOf(session));
  const hasPage = await userCanAccessPageKey(session, "reports");
  if (!oversight && !hasPage) {
    return { error: Response.json({ message: "Forbidden" }, { status: 403 }) };
  }
  // One-time, background: make sure the report date columns are indexed so the
  // range/sort queries never full-scan (never blocks this request).
  ensureReportIndexes();
  await loadUserScope(session, query);
  // A user admitted without oversight (i.e. via an assigned "reports" page) sees
  // the supervisor-visible modules only; a genuine oversight user keeps full.
  return { session, roleOverride: oversight ? undefined : ROLES.SUPERVISOR };
}
