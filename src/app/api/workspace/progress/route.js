import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";

// GET ?date_from=&date_to= : the signed-in caller's progress grouped by call
// OUTCOME for the selected range (defaults to TODAY). One aggregated query — no
// per-status queries. Dates are in the application timezone (Asia/Kolkata, a
// fixed +05:30, no DST); called_at is a UTC TIMESTAMP so we CONVERT_TZ it.
const IST = "+05:30";

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (isOversight(session)) {
      return NextResponse.json({ message: "Only callers have calling progress." }, { status: 403 });
    }
    const userId = session.user.id;
    const { searchParams } = new URL(req.url);
    const date_from = searchParams.get("date_from");
    const date_to = searchParams.get("date_to");

    const dateExpr = `DATE(CONVERT_TZ(c.called_at,'+00:00','${IST}'))`;
    const where = ["c.user_id = ?"];
    const params = [userId];
    if (date_from) { where.push(`${dateExpr} >= ?`); params.push(date_from); }
    if (date_to) { where.push(`${dateExpr} <= ?`); params.push(date_to); }
    if (!date_from && !date_to) {
      where.push(`${dateExpr} = DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','${IST}'))`);
    }

    const [agg] = await query(
      `SELECT
         COUNT(*)                          AS total_calls,
         SUM(cs.name = 'Phone Picked')     AS connected,
         SUM(cs.name = 'Not Picked')       AS no_answer,
         SUM(cs.name = 'Busy')             AS busy,
         SUM(cs.name = 'Switched Off')     AS switched_off,
         SUM(cs.name = 'Wrong Number')     AS wrong_number,
         SUM(cs.name = 'Rudely Behaved')   AS rejected,
         SUM(c.follow_up_date IS NOT NULL) AS follow_up
       FROM calls c
       LEFT JOIN call_statuses cs ON cs.id = c.status_id
       WHERE ${where.join(" AND ")}`,
      params
    );

    const n = (v) => Number(v) || 0;
    return NextResponse.json({
      total_calls: n(agg?.total_calls),
      outcomes: {
        connected: n(agg?.connected),
        no_answer: n(agg?.no_answer),
        busy: n(agg?.busy),
        switched_off: n(agg?.switched_off),
        wrong_number: n(agg?.wrong_number),
        rejected: n(agg?.rejected),
        follow_up: n(agg?.follow_up),
      },
    });
  } catch (err) {
    console.error("workspace progress error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
