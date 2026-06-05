import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { query } from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisor(session)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const calls = await query(
      `SELECT
         c.id, c.person_name, c.phone_number, c.remarks, c.follow_up_date,
         c.is_vip, c.called_at, c.sentiment,
         u.username AS agent_name,
         cs.name AS status_name
       FROM calls c
       LEFT JOIN users u ON u.id = c.user_id
       LEFT JOIN call_statuses cs ON cs.id = c.status_id
       WHERE c.is_follow_up_required = 1
       ORDER BY c.is_vip DESC, c.follow_up_date IS NULL, c.follow_up_date ASC
       LIMIT 500`
    );

    return Response.json({ follow_ups: calls });
  } catch (err) {
    console.error("supervisor/follow-ups error:", err);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
