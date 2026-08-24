import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isSuperAdmin } from "@/lib/permissions";
import { userCanAccessPageKey, isPageRestricted } from "@/lib/pageAccess";
import { NextResponse } from "next/server";
import { ensureLeaderAssessmentTables } from "@/lib/leaderAssessment";

// Shared gate for every Leader Assessment API route. Oversight (Super Admin +
// Supervisor + tiered admins) may read/write; delete is Super-Admin-only. Also
// lazily ensures the module's tables exist before any query runs.
//
// allowPageKeys (PROMPT 10 Part A): additional Page-Access keys that also admit
// the caller — e.g. the Caste/Polling master routes pass their own page key so a
// user the Super Admin GRANTED that page can use it even without oversight. This
// only ever widens read/write on those specific endpoints; delete stays
// Super-Admin-only.
export async function guard({ superAdminOnly = false, allowPageKeys = [] } = {}) {
  const session = await getServerSession(authOptions);
  let permitted = false;
  if (session) {
    // Page-restricted users: role ignored — admitted only if they were assigned
    // the Leader Assessment page (general routes) or one of this route's
    // allowPageKeys (e.g. caste_master / polling_master). Non-restricted users:
    // the normal oversight rule, unchanged.
    if (await isPageRestricted(session)) {
      const keys = ["leader_assessment", ...allowPageKeys];
      for (const k of keys) {
        // eslint-disable-next-line no-await-in-loop
        if (await userCanAccessPageKey(session, k)) { permitted = true; break; }
      }
    } else {
      permitted = isOversight(session);
    }
  }
  if (!permitted) {
    return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) };
  }
  if (superAdminOnly && !isSuperAdmin(session)) {
    return { error: NextResponse.json({ message: "You do not have permission to do that." }, { status: 403 }) };
  }
  try {
    await ensureLeaderAssessmentTables();
  } catch (e) {
    console.error("[LA] ensure tables failed:", e);
    return { error: NextResponse.json({ message: "Assessment storage is not ready." }, { status: 500 }) };
  }
  return { session };
}

export const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate" };
