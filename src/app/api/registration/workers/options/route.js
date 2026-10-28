import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRegistrationAccess, NO_STORE, parseRegFilters } from "@/lib/registrationGuard";
import { workerScopeCond } from "@/lib/registrationScope";

// GET /api/registration/workers/options - the people a registration can be "Added By" (the drive's worker roster:
// reg_workers, the same records p.worker_id points at), id + name + User ID + mobile, for the Added By filter.
// Same access gate and same Zone-wise worker scope as the Workers list - nobody sees workers outside their territory.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req) {
  try {
    const { session, error } = await requireRegistrationAccess();
    if (error) return error;
    const f = parseRegFilters(new URL(req.url).searchParams);
    const scope = workerScopeCond(session, "w");
    const where = ["1 = 1"], params = [];
    if (f.campaignId) { where.push("w.campaign_id = ?"); params.push(f.campaignId); }
    if (scope && scope.cond) { where.push(scope.cond); params.push(...(scope.params || [])); }
    const workers = await query(
      `SELECT w.id, w.name, w.worker_code, w.mobile FROM reg_workers w WHERE ${where.join(" AND ")} ORDER BY w.name ASC, w.id ASC LIMIT 5000`,
      params
    );
    return NextResponse.json({ workers }, { headers: NO_STORE });
  } catch (e) {
    console.error("[registration] workers options error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
