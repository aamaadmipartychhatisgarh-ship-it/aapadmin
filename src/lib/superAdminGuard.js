import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/permissions";
import { resolvePeriod } from "@/lib/membershipSchema";

// Shared no-store headers + Super-Admin gate for the Worker & Membership APIs.
// Every route calls requireSuperAdmin() first; a non-super session gets a 403
// and no data is ever queried or returned.
export const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function requireSuperAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE }) };
  if (!isSuperAdmin(session)) return { error: NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE }) };
  return { session };
}

// Parse the common geo + period + search query params shared across the routes.
export function parseCommonFilters(searchParams) {
  const num = (k) => { const v = searchParams.get(k); return v && /^\d+$/.test(v) ? Number(v) : null; };
  const { from, to } = resolvePeriod(
    searchParams.get("period") || "",
    searchParams.get("from") || null,
    searchParams.get("to") || null
  );
  return {
    from, to,
    assemblyId: num("assembly_id"),
    wardId: num("ward_id"),
    boothId: num("booth_id"),
    workerId: num("worker_id"),
    search: (searchParams.get("search") || "").trim(),
  };
}
