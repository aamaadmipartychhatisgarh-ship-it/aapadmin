import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { loadUserScope, roleOf, OVERSIGHT_ROLES } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureReportIndexes } from "@/lib/reports/ensureIndexes";

// Shared by every Reports Center route (list/run/export/saved-filters):
// oversight-only at the surface; per-module access is refined inside the
// engine (some modules are super-admin only), data is geo-scoped to the
// caller's territory.
export async function reportsGuard() {
  const session = await getServerSession(authOptions);
  if (!session) return { error: Response.json({ message: "Unauthorized" }, { status: 401 }) };
  if (!OVERSIGHT_ROLES.includes(roleOf(session))) {
    return { error: Response.json({ message: "Forbidden" }, { status: 403 }) };
  }
  // One-time, background: make sure the report date columns are indexed so the
  // range/sort queries never full-scan (never blocks this request).
  ensureReportIndexes();
  await loadUserScope(session, query);
  return { session };
}
