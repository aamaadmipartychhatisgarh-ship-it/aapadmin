import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isTopAdmin, isSuperAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { ensureRegistrationSchema, resolveRegPeriod } from "@/lib/registrationSchema";

// Shared gate for every ADMIN-side Voter & Worker Registration route. The public
// form endpoints under /api/public/registration are deliberately NOT covered by
// this — they are the only unauthenticated surface of the module, and they can
// read/write nothing except through a valid worker link token.
//
// Baseline access is Super Admin + State Admin (the drive is run centrally); the
// page is registered in lib/pages.js, so a Super Admin can additionally GRANT it
// to any other user through Page Access and pageAllowed() admits them here.
export const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function requireRegistrationAccess({ superAdminOnly = false } = {}) {
  const session = await getServerSession(authOptions);
  if (!session) return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE }) };

  let permitted = false;
  try {
    permitted = await pageAllowed(session, "voter_registration", isTopAdmin(session));
  } catch (e) {
    // A Page-Access lookup failure must never deny an admin who holds the page by
    // role — fall back to the baseline role check rather than locking everyone out.
    console.error("[registration] guard access check failed, falling back to role:", e?.message || e);
    permitted = isTopAdmin(session);
  }
  if (!permitted) return { error: NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE }) };
  if (superAdminOnly && !isSuperAdmin(session)) {
    return { error: NextResponse.json({ message: "You do not have permission to do that." }, { status: 403, headers: NO_STORE }) };
  }

  await ensureRegistrationSchema();
  return { session };
}

// The filter set shared by the dashboard, ranking, list and export routes, so
// every view of the drive means the same thing by the same query string.
export function parseRegFilters(searchParams) {
  const num = (k) => { const v = searchParams.get(k); return v && /^\d+$/.test(v) ? Number(v) : null; };
  const str = (k) => (searchParams.get(k) || "").trim() || null;
  const { from, to } = resolveRegPeriod(searchParams.get("period") || "", str("from"), str("to"));
  return {
    from, to,
    campaignId: num("campaign_id"),
    workerId: num("worker_id"),
    ward: str("ward"),
    personType: ["voter", "worker"].includes(searchParams.get("person_type")) ? searchParams.get("person_type") : null,
    status: ["active", "duplicate", "rejected"].includes(searchParams.get("status")) ? searchParams.get("status") : "active",
    search: str("search"),
  };
}
