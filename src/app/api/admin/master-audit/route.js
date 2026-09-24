import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { ensureAuditSchema, MASTER_LABELS } from "@/lib/audit";

// GET /api/admin/master-audit — READ-ONLY master-data audit trail.
// Reads the shared audit_logs, scoped to master-data entries (entity_type LIKE
// 'master_data:%'). Filters: search, action, master, user, date range; paginated.
// Gated by the Master Data page permission (Super Admin always).
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "master_data", session && isAdmin(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    await ensureAuditSchema();
    const sp = new URL(req.url).searchParams;
    const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") || "30", 10) || 30));
    const offset = (page - 1) * limit;

    const where = ["a.entity_type LIKE 'master_data:%'"];
    const params = [];
    const action = (sp.get("action") || "").trim();
    if (action) { where.push("a.action = ?"); params.push(action); }
    const master = (sp.get("master") || "").trim();
    if (master) { where.push("a.entity_type = ?"); params.push(`master_data:${master}`); }
    const user = (sp.get("user") || "").trim();
    if (user) { where.push("(a.actor_name LIKE ? OR a.actor_user_id = ?)"); params.push(`%${user}%`, /^\d+$/.test(user) ? user : -1); }
    const search = (sp.get("search") || "").trim();
    if (search) { where.push("(a.actor_name LIKE ? OR a.entity_id LIKE ? OR a.details LIKE ?)"); const l = `%${search}%`; params.push(l, l, l); }
    const dateFrom = (sp.get("date_from") || "").trim();
    if (dateFrom) { where.push("DATE(a.created_at) >= ?"); params.push(dateFrom); }
    const dateTo = (sp.get("date_to") || "").trim();
    if (dateTo) { where.push("DATE(a.created_at) <= ?"); params.push(dateTo); }
    const whereSql = `WHERE ${where.join(" AND ")}`;

    let rows = [], total = 0, actions = [], masters = [], users = [];
    try {
      const [{ total: t }] = await query(`SELECT COUNT(*) AS total FROM audit_logs a ${whereSql}`, params);
      total = Number(t) || 0;
      const raw = await query(
        `SELECT a.id, a.actor_user_id, a.actor_name, a.action, a.entity_type, a.entity_id, a.details, a.created_at,
                u.username AS actor_username
           FROM audit_logs a
           LEFT JOIN users u ON u.id = a.actor_user_id
           ${whereSql}
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT ${limit} OFFSET ${offset}`,
        params
      );
      rows = raw.map((r) => {
        let d = {};
        try { d = r.details ? JSON.parse(r.details) : {}; } catch { d = {}; }
        return {
          id: r.id,
          created_at: r.created_at,
          actor_user_id: r.actor_user_id,
          actor_name: r.actor_name || r.actor_username || null,
          action: r.action,
          master_key: r.entity_type ? r.entity_type.replace(/^master_data:/, "") : null,
          master: d.master || (r.entity_type ? r.entity_type.replace(/^master_data:/, "") : null),
          record_id: r.entity_id,
          record_name: d.name ?? null,
          previous_value: d.before ?? null,
          new_value: d.after ?? null,
          ip: d.ip ?? null,
          source: d.source ?? null,
        };
      });
      // Filter option lists (distinct within master-data scope).
      actions = (await query(`SELECT DISTINCT action FROM audit_logs WHERE entity_type LIKE 'master_data:%' ORDER BY action`)).map((x) => x.action);
      masters = (await query(`SELECT DISTINCT entity_type FROM audit_logs WHERE entity_type LIKE 'master_data:%' ORDER BY entity_type`))
        .map((x) => { const k = x.entity_type.replace(/^master_data:/, ""); return { key: k, label: MASTER_LABELS[k] || k }; });
      users = await query(`SELECT DISTINCT a.actor_user_id AS id, COALESCE(u.username, a.actor_name) AS name
                             FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
                            WHERE a.entity_type LIKE 'master_data:%' AND a.actor_name IS NOT NULL
                            ORDER BY name`);
    } catch (e) {
      if (e.code !== "ER_NO_SUCH_TABLE" && e.errno !== 1146) throw e; // pre-migration → empty
    }
    return NextResponse.json({ logs: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)), actions, masters, users }, { headers: NO_STORE });
  } catch (err) {
    console.error("[master-audit] GET error:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
