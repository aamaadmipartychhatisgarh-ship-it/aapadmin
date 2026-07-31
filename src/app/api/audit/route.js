import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

// GET /api/audit?action=&actor=&date_from=&date_to=&page=&limit=
// Read the audit trail (admins only). Paginated; filterable by action, actor and
// date range. Returns { logs, total, page, pages }.
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const actor = searchParams.get("actor");
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
    const offset = (page - 1) * limit;

    const where = ["1=1"];
    const params = [];
    if (action) { where.push("a.action = ?"); params.push(action); }
    if (actor) { where.push("(a.actor_name LIKE ? OR a.actor_user_id = ?)"); params.push(`%${actor}%`, actor); }
    if (dateFrom) { where.push("DATE(a.created_at) >= ?"); params.push(dateFrom); }
    if (dateTo) { where.push("DATE(a.created_at) <= ?"); params.push(dateTo); }
    const whereSql = `WHERE ${where.join(" AND ")}`;

    let logs = [], total = 0, actions = [];
    try {
      const [{ total: t }] = await query(`SELECT COUNT(*) AS total FROM audit_logs a ${whereSql}`, params);
      total = Number(t) || 0;
      logs = await query(
        `SELECT a.id, a.actor_user_id, a.actor_name, a.action, a.entity_type, a.entity_id, a.details, a.created_at,
                u.username AS actor_username
           FROM audit_logs a
           LEFT JOIN users u ON u.id = a.actor_user_id
           ${whereSql}
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT ${limit} OFFSET ${offset}`,
        params
      );
      actions = (await query("SELECT DISTINCT action FROM audit_logs ORDER BY action")).map((r) => r.action);
    } catch (e) {
      if (e.code !== "ER_NO_SUCH_TABLE") throw e; // pre-migration → empty
    }
    return NextResponse.json({ logs, total, page, pages: Math.ceil(total / limit) || 1, actions });
  } catch (err) {
    console.error("audit GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
