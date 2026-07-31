import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, scopeFilterSync } from "@/lib/permissions";
import { query } from "@/lib/db";

// Events & Mobilization. GET lists events (oversight sees all within their
// geographic scope; everyone else sees upcoming events too — read-only).
// POST creates an event (oversight only).
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const type = searchParams.get("type");
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");
    const search = searchParams.get("search");

    const where = ["1=1"];
    const params = [];
    if (status) { where.push("e.status = ?"); params.push(status); }
    if (type) { where.push("e.type = ?"); params.push(type); }
    if (dateFrom) { where.push("e.event_date >= ?"); params.push(dateFrom); }
    if (dateTo) { where.push("e.event_date <= ?"); params.push(dateTo); }
    if (search) { where.push("(e.title LIKE ? OR e.venue LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
    // Geographic scope for oversight (district column).
    if (isOversight(session)) {
      const scope = scopeFilterSync(session.user, "e", { cols: ["district_id"] });
      if (scope.where) { where.push(scope.where.replace(/^AND /, "")); params.push(...scope.params); }
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;

    let events = [], counts = {};
    try {
      events = await query(
        `SELECT e.*, ld.name AS district_name, u.username AS created_by_name,
                (SELECT COUNT(*) FROM event_attendees a WHERE a.event_id = e.id) AS invited,
                (SELECT COUNT(*) FROM event_attendees a WHERE a.event_id = e.id AND a.attended = 1) AS attended
           FROM events e
           LEFT JOIN locations ld ON ld.id = e.district_id
           LEFT JOIN users u ON u.id = e.created_by_user_id
           ${whereSql}
          ORDER BY e.event_date DESC, e.event_time DESC, e.id DESC
          LIMIT 500`,
        params
      );
      const [c] = await query(
        `SELECT COUNT(*) AS total,
                SUM(status='scheduled' AND event_date >= CURDATE()) AS upcoming,
                SUM(status='completed') AS completed
           FROM events e ${whereSql}`, params
      );
      counts = c || {};
    } catch (e) {
      if (e.code !== "ER_NO_SUCH_TABLE") throw e;
    }
    return NextResponse.json({ events, counts });
  } catch (err) {
    console.error("events GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const d = await req.json();
    if (!d.title || !d.event_date) return NextResponse.json({ message: "Title and date are required" }, { status: 400 });
    const res = await query(
      `INSERT INTO events (title, type, description, event_date, event_time, venue, district_id, zone_id, status, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.title, d.type || "meeting", d.description || null, d.event_date, d.event_time || null,
       d.venue || null, d.district_id || null, d.zone_id || null, d.status || "scheduled", session.user.id]
    );
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("events POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
