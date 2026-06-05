import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { query } from "@/lib/db";

const LEVEL_COLUMN = {
  zone: "zone_id",
  lok_sabha: "lok_sabha_id",
  district: "district_id",
  assembly: "assembly_id",
  ward: "ward_id",
  booth: "booth_id",
};

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisor(session)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const level = searchParams.get("level") || "district";
    const col = LEVEL_COLUMN[level];
    if (!col) {
      return Response.json({ message: "Invalid level" }, { status: 400 });
    }

    const rows = await query(
      `SELECT
         l.id AS area_id,
         l.name AS area_name,
         COUNT(c.id) AS total_calls,
         SUM(CASE WHEN cs.name = 'Phone Picked' THEN 1 ELSE 0 END) AS connected,
         SUM(CASE WHEN c.sentiment IN ('positive','supporter') THEN 1 ELSE 0 END) AS positive,
         SUM(CASE WHEN c.sentiment IN ('negative','opponent') THEN 1 ELSE 0 END) AS negative,
         SUM(CASE WHEN c.sentiment = 'neutral' THEN 1 ELSE 0 END) AS neutral
       FROM locations l
       LEFT JOIN calls c ON c.${col} = l.id
       LEFT JOIN call_statuses cs ON cs.id = c.status_id
       WHERE l.type = ?
       GROUP BY l.id, l.name
       ORDER BY total_calls DESC`,
      [level]
    );

    return Response.json({ level, areas: rows });
  } catch (err) {
    console.error("supervisor/areas error:", err);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
