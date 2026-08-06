import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, isSupervisorRole, isCaller, scopeFilterSync, normalizeRole, ROLES } from "@/lib/permissions";
import { query } from "@/lib/db";
import { buildContactPersonFilter } from "@/lib/contactFilter";
import { supervisorScopeFilter } from "@/lib/supervisorScope";

// GET /api/not-interested — contacts that match ANY "Not Interested" rule:
//   1. Switched Off more than 5 times          (feature-detected columns)
//   2. a call sentiment of Negative
//   3. a call sentiment of Opponent
//   4. marked Not a Supporter                  (sentiment 'not_supporter')
//   5. any call disposition of Rudely Behaved  (call_statuses.name)
// One row per contact (GROUP-free join on a per-contact aggregate → no dupes),
// with the reason flags so the UI can show WHY each contact qualifies.
//
// Role scope: Super/State Admin see everything; a Supervisor is limited to their
// territory; a Caller sees only contacts assigned to them; other admin tiers use
// their geographic scope. Same filters as the Contacts dashboard.
export const dynamic = "force-dynamic";

let colsPromise;
async function contactColumns() {
  if (!colsPromise) {
    colsPromise = query(
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts'`
    ).then((r) => new Set(r.map((x) => x.name))).catch((e) => { colsPromise = undefined; throw e; });
  }
  return colsPromise;
}

function idList(raw) {
  if (!raw) return [];
  return [...new Set(String(raw).split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0))];
}

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search");
    const zone_id = searchParams.get("zone_id");
    const lok_sabha_id = searchParams.get("lok_sabha_id");
    const district_id = searchParams.get("district_id");
    const assembly_ids = idList(searchParams.get("assembly_ids") || searchParams.get("assembly_id"));
    const designation_ids = idList(searchParams.get("designation_ids") || searchParams.get("designation_id"));
    const assigned_to = searchParams.get("caller") || searchParams.get("assigned_to");
    const reason = searchParams.get("reason"); // switched_off | negative | opponent | not_supporter | rude
    const statusF = searchParams.get("status");
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("page_size") || "50", 10)));
    const offset = (page - 1) * pageSize;

    // Switched-Off count: only computable where both feature columns exist.
    const cols = await contactColumns();
    const switchedExpr = (cols.has("wrong_number_reason") && cols.has("wrong_attempts"))
      ? "CASE WHEN c.wrong_number_reason = 'switched_off' THEN COALESCE(c.wrong_attempts, 0) ELSE 0 END"
      : "0";

    // ---- Filters (identical semantics to the Contacts dashboard) ----
    let where = " WHERE 1=1";
    const params = [];
    const person = buildContactPersonFilter({ zone_id, lok_sabha_id, district_id, assembly_ids, designation_ids });
    where += person.where; params.push(...person.params);
    if (assigned_to) { where += " AND c.assigned_to_user_id = ?"; params.push(assigned_to); }
    if (search) { where += " AND (c.person_name LIKE ? OR c.phone_number LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }
    if (statusF === "assigned") where += " AND c.assigned_to_user_id IS NOT NULL";
    else if (statusF === "unassigned") where += " AND c.assigned_to_user_id IS NULL";
    else if (statusF === "done") where += " AND c.is_completed = 1";
    else if (statusF === "pending") where += " AND c.is_completed = 0";
    if (dateFrom) { where += " AND agg.last_call_date >= ?"; params.push(dateFrom + " 00:00:00"); }
    if (dateTo) { where += " AND agg.last_call_date <= ?"; params.push(dateTo + " 23:59:59"); }

    // ---- Role scope ----
    const role = normalizeRole(session.user.role);
    if (isCaller(session)) {
      where += " AND c.assigned_to_user_id = ?"; params.push(session.user.id);
    } else if (isSupervisorRole(session)) {
      const scope = supervisorScopeFilter(session.user, "c");
      where += " " + scope.where; params.push(...scope.params);
    } else if (role !== ROLES.SUPER_ADMIN && role !== ROLES.STATE_ADMIN) {
      const scope = scopeFilterSync(session.user, "c");
      where += " " + scope.where; params.push(...scope.params);
    }
    // Super/State admin: no geographic restriction.

    const FROM = `
      FROM contacts c
      LEFT JOIN workers w ON w.id = c.worker_id
      LEFT JOIN (
        SELECT cx.contact_id,
               COUNT(*) AS total_calls,
               MAX(cx.called_at) AS last_call_date,
               MAX(cx.sentiment = 'negative') AS has_negative,
               MAX(cx.sentiment = 'opponent') AS has_opponent,
               MAX(cx.sentiment = 'not_supporter') AS has_not_supporter,
               MAX(cs.name IN ('Rudely Behaved', 'Rude', 'Rudely Rejected')) AS has_rude
          FROM calls cx
          LEFT JOIN call_statuses cs ON cs.id = cx.status_id
         GROUP BY cx.contact_id
      ) agg ON agg.contact_id = c.id
      ${where}`;

    // A contact qualifies if ANY rule matches — OR by default, or exactly ONE
    // rule when the caller filters by a specific Reason. Kept in HAVING so it
    // reads off the computed switched_off_count alias and the aggregate flags.
    // Filtering happens here (server-side), so it composes with every other
    // filter, the role scope, pagination and the count.
    const REASON_HAVING = {
      switched_off: "switched_off_count > 5",
      negative: "COALESCE(has_negative,0) = 1",
      opponent: "COALESCE(has_opponent,0) = 1",
      not_supporter: "COALESCE(has_not_supporter,0) = 1",
      rude: "COALESCE(has_rude,0) = 1",
    };
    const HAVING = `HAVING ${REASON_HAVING[reason] || `switched_off_count > 5
                       OR COALESCE(has_negative,0) = 1
                       OR COALESCE(has_opponent,0) = 1
                       OR COALESCE(has_not_supporter,0) = 1
                       OR COALESCE(has_rude,0) = 1`}`;

    // Total (one row per contact) matching filters + rules.
    const countRows = await query(
      `SELECT COUNT(*) AS total FROM (
         SELECT c.id, ${switchedExpr} AS switched_off_count,
                agg.has_negative, agg.has_opponent, agg.has_not_supporter, agg.has_rude
         ${FROM}
         ${HAVING}
       ) t`,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const rows = await query(
      `SELECT c.id, c.person_name, c.phone_number, c.address, c.is_completed,
              c.assigned_to_user_id, c.photo_url,
              u.username AS assigned_caller_name,
              COALESCE(NULLIF(TRIM(w.position), ''), dsg.name) AS designation_name,
              COALESCE(cz.name, lz.name) AS zone_name,
              COALESCE(cls.name, lls.name) AS lok_sabha_name,
              la.name AS assembly_name,
              ld.name AS district_name,
              ${switchedExpr} AS switched_off_count,
              COALESCE(agg.total_calls, 0) AS total_calls,
              agg.last_call_date,
              COALESCE(agg.has_negative, 0) AS has_negative,
              COALESCE(agg.has_opponent, 0) AS has_opponent,
              COALESCE(agg.has_not_supporter, 0) AS has_not_supporter,
              COALESCE(agg.has_rude, 0) AS has_rude
         FROM contacts c
         LEFT JOIN workers w ON w.id = c.worker_id
         LEFT JOIN users u ON u.id = c.assigned_to_user_id
         LEFT JOIN designations dsg ON dsg.id = c.designation_id
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations lls ON lls.id = ld.parent_id
         LEFT JOIN locations lz ON lz.id = lls.parent_id
         LEFT JOIN locations cz ON cz.id = c.zone_id
         LEFT JOIN locations cls ON cls.id = c.lok_sabha_id
         LEFT JOIN locations la ON la.id = c.assembly_id
         LEFT JOIN (
           SELECT cx.contact_id,
                  COUNT(*) AS total_calls,
                  MAX(cx.called_at) AS last_call_date,
                  MAX(cx.sentiment = 'negative') AS has_negative,
                  MAX(cx.sentiment = 'opponent') AS has_opponent,
                  MAX(cx.sentiment = 'not_supporter') AS has_not_supporter,
                  MAX(cs.name IN ('Rudely Behaved', 'Rude', 'Rudely Rejected')) AS has_rude
             FROM calls cx
             LEFT JOIN call_statuses cs ON cs.id = cx.status_id
            GROUP BY cx.contact_id
         ) agg ON agg.contact_id = c.id
         ${where}
         ${HAVING}
         ORDER BY agg.last_call_date IS NULL, agg.last_call_date DESC, c.id DESC
         LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    return NextResponse.json({ rows, total, page, page_size: pageSize });
  } catch (err) {
    console.error("not-interested GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
