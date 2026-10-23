import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { userCanAccessPageKey } from "@/lib/pageAccess";
import { normalizeRole, ROLES } from "@/lib/permissions";
import { loadFollowUps, parseFollowUpFilters } from "@/lib/followUpFeed";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// GET /api/influencers/follow-up-reminders?range=all|today|tomorrow|7|30&search=
// The signed-in Supervisor-2's upcoming influencer follow-ups (Follow-up Date today
// or later, application timezone), earliest first. Rows due tomorrow carry the
// "Tomorrow Follow-up" label. `available` is the unfiltered upcoming count (drives
// the Export button). The assignee is always the session user — never a parameter —
// so one supervisor can never read another's records. Live from the records, so a
// changed date / reassignment is reflected immediately and nothing is duplicated.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (normalizeRole(session.user?.role) !== ROLES.SUPERVISOR) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    if (!(await userCanAccessPageKey(session, "influencers"))) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    const f = parseFollowUpFilters(new URL(req.url).searchParams);
    const feed = await loadFollowUps(session.user.id, f);
    return NextResponse.json({ today: feed.today, date: feed.tomorrow, available: feed.available, reminders: feed.rows }, { headers: NO_STORE });
  } catch (err) {
    console.error("[influencer] follow-up reminders:", err?.sqlMessage || err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
