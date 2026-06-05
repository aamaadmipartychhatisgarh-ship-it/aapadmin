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
    const search = searchParams.get("search");
    const params = [];
    let where = "WHERE c.remarks IS NOT NULL AND c.remarks <> ''";
    if (search) {
      where += " AND c.remarks LIKE ?";
      params.push(`%${search}%`);
    }

    const rows = await query(
      `SELECT
         c.id, c.person_name, c.phone_number, c.remarks, c.called_at,
         u.username AS agent_name,
         cs.name AS status_name,
         ld.name AS district_name
       FROM calls c
       LEFT JOIN users u ON u.id = c.user_id
       LEFT JOIN call_statuses cs ON cs.id = c.status_id
       LEFT JOIN locations ld ON ld.id = c.district_id
       ${where}
       ORDER BY c.called_at DESC
       LIMIT 500`,
      params
    );

    return Response.json({ remarks: rows });
  } catch (err) {
    console.error("supervisor/remarks error:", err);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
