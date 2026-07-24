import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";

// GET ?date_from=&date_to= : per-day calling progress for the signed-in caller.
// Returns, for each day in the range, how many calls were logged and how many
// distinct contacts were worked — so a caller can see what they did on each date
// and pick up where they left off. Defaults to the last 7 days.
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

    const where = ["user_id = ?"];
    const params = [userId];
    if (date_from) { where.push("DATE(called_at) >= ?"); params.push(date_from); }
    if (date_to) { where.push("DATE(called_at) <= ?"); params.push(date_to); }
    if (!date_from && !date_to) { where.push("called_at >= CURDATE() - INTERVAL 6 DAY"); }

    const days = await query(
      `SELECT DATE(called_at) AS day,
              COUNT(*) AS calls,
              COUNT(DISTINCT contact_id) AS contacts
         FROM calls
        WHERE ${where.join(" AND ")}
        GROUP BY DATE(called_at)
        ORDER BY day DESC`,
      params
    );

    const total_calls = days.reduce((s, d) => s + Number(d.calls || 0), 0);
    return NextResponse.json({ days, total_calls });
  } catch (err) {
    console.error("workspace progress error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
