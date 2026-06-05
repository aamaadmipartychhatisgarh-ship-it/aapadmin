import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    await query(
      `UPDATE attendance_log
         SET logout_at = NOW(),
             total_minutes = TIMESTAMPDIFF(MINUTE, login_at, NOW())
       WHERE user_id = ? AND logout_at IS NULL
       ORDER BY login_at DESC LIMIT 1`,
      [session.user.id]
    );
    return Response.json({ ok: true });
  } catch (err) {
    console.error("logout-mark error:", err);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
