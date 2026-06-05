import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const level = searchParams.get("level");
    const params = [];
    let where = "WHERE 1=1";
    if (level) { where += " AND t.level = ?"; params.push(level); }

    const teams = await query(
      `SELECT t.*, l.name AS location_name, w.name AS leader_name,
              (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS member_count,
              COALESCE((SELECT ROUND(AVG(wk.activity_score))
                          FROM team_members tm JOIN workers wk ON wk.id = tm.worker_id
                         WHERE tm.team_id = t.id), 0) AS avg_activity
         FROM teams t
         LEFT JOIN locations l ON l.id = t.location_id
         LEFT JOIN workers w ON w.id = t.leader_worker_id
         ${where}
         ORDER BY FIELD(t.level,'state','zone','lok_sabha','district','assembly','ward','mandal','booth'), t.name`,
      params
    );
    return NextResponse.json({ teams });
  } catch (err) {
    console.error("teams GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const d = await req.json();
    if (!d.name || !d.level) return NextResponse.json({ message: "Name and level required" }, { status: 400 });
    const res = await query(
      `INSERT INTO teams (name, level, location_id, leader_worker_id) VALUES (?, ?, ?, ?)`,
      [d.name, d.level, d.location_id || null, d.leader_worker_id || null]
    );
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("teams POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
