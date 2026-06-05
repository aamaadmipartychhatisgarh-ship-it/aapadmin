import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { query } from "@/lib/db";

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisor(session)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date"); // YYYY-MM-DD
    const params = [];
    let where = "WHERE 1=1";
    if (date) {
      where += " AND DATE(a.login_at) = ?";
      params.push(date);
    } else {
      where += " AND DATE(a.login_at) = CURDATE()";
    }

    const rows = await query(
      `SELECT
         a.id,
         a.user_id,
         u.username,
         u.role,
         a.login_at,
         a.logout_at,
         COALESCE(a.total_minutes, TIMESTAMPDIFF(MINUTE, a.login_at, NOW())) AS minutes_elapsed
       FROM attendance_log a
       JOIN users u ON u.id = a.user_id
       ${where}
       ORDER BY a.login_at DESC`,
      params
    );

    return Response.json({ attendance: rows });
  } catch (err) {
    console.error("supervisor/attendance error:", err);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
