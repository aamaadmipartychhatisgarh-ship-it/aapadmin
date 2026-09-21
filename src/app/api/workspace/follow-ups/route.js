import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { isPageRestricted, userCanAccessPageKey } from "@/lib/pageAccess";
import { resolveActingUserId } from "@/lib/actAs";
import { query } from "@/lib/db";
import { hasWrongNumberColumn, hasFollowUpTimeColumn } from "@/lib/contactExtras";

// GET /api/workspace/follow-ups?date=YYYY-MM-DD
// The caller's follow-up calls SCHEDULED for one exact date, for the Follow-up Calls
// date filter in My Workspace. Scope + permissions are IDENTICAL to the workspace
// queue: the caller's own assigned, not-completed, non-wrong contacts only (a Super
// Admin operating a caller's dashboard sees THAT caller's, via resolveActingUserId).
// The date is matched on the stored follow-up date (contacts.follow_up_date), a DATE
// column, with a direct DATE(...) = ? comparison — no CURDATE()/browser date and no
// time component — so selecting 21 Sep returns exactly 21 Sep's follow-ups (no
// off-by-one). The filter only changes which date is shown; it never widens access.
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    if (await isPageRestricted(session) && !(await userCanAccessPageKey(session, "workspace"))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { userId, impersonating } = await resolveActingUserId(session);
    if (isOversight(session) && !impersonating) {
      return NextResponse.json({ message: "Only callers have a workspace queue." }, { status: 403 });
    }

    const date = new URL(req.url).searchParams.get("date") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ message: "A valid date (YYYY-MM-DD) is required." }, { status: 400 });
    }

    const hasWrong = await hasWrongNumberColumn();
    const notWrong = hasWrong ? " AND (c.is_wrong_number = 0 OR c.is_wrong_number IS NULL)" : "";
    const hasFupTime = await hasFollowUpTimeColumn();

    const rows = await query(
      `SELECT c.*, ld.name AS district_name
         FROM contacts c
         LEFT JOIN locations ld ON ld.id = c.district_id
        WHERE c.assigned_to_user_id = ?
          AND c.is_completed = 0
          AND c.follow_up_date IS NOT NULL
          AND DATE(c.follow_up_date) = ?${notWrong}
        ORDER BY ${hasFupTime ? "c.follow_up_time IS NULL ASC, c.follow_up_time ASC, " : ""}c.assigned_at IS NULL ASC, c.assigned_at DESC, c.id DESC
        LIMIT 200`,
      [userId, date]
    );

    return NextResponse.json(
      { follow_ups: rows, date, total: rows.length },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("workspace follow-ups error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
