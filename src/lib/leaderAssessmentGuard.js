import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isSuperAdmin } from "@/lib/permissions";
import { NextResponse } from "next/server";
import { ensureLeaderAssessmentTables } from "@/lib/leaderAssessment";

// Shared gate for every Leader Assessment API route. Oversight (Super Admin +
// Supervisor + tiered admins) may read/write; delete is Super-Admin-only. Also
// lazily ensures the module's tables exist before any query runs.
export async function guard({ superAdminOnly = false } = {}) {
  const session = await getServerSession(authOptions);
  if (!session || !isOversight(session)) {
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
