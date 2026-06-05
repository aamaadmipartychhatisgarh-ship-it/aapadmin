import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;

    const rows = await query(
      `SELECT c.id, c.called_at, c.duration_seconds, c.sentiment, c.remarks,
              c.is_follow_up_required, c.follow_up_date,
              cs.name AS status_name,
              u.username AS agent_name
         FROM calls c
         LEFT JOIN call_statuses cs ON cs.id = c.status_id
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.contact_id = ?
        ORDER BY c.called_at DESC
        LIMIT 20`,
      [id]
    );
    return NextResponse.json({ history: rows });
  } catch (err) {
    console.error("contact history error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
