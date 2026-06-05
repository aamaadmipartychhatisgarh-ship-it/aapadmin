import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, scopeFilterSync } from "@/lib/permissions";
import { query } from "@/lib/db";
import { LIVE_THRESHOLD_SECONDS } from "@/lib/supervisor";

// Single endpoint that powers the admin overview: KPIs with deltas vs prior period,
// contact funnel, live activity strip, top districts by progress.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const range = searchParams.get("range") || "today"; // today | yesterday | week

    // Geographic scope: zone/district/assembly admins see only their territory.
    const scope = scopeFilterSync(session.user, "c");

    let curWhere, prevWhere;
    if (range === "yesterday") {
      curWhere = "DATE(called_at) = CURDATE() - INTERVAL 1 DAY";
      prevWhere = "DATE(called_at) = CURDATE() - INTERVAL 2 DAY";
    } else if (range === "week") {
      curWhere = "called_at >= CURDATE() - INTERVAL 6 DAY";
      prevWhere = "called_at >= CURDATE() - INTERVAL 13 DAY AND called_at < CURDATE() - INTERVAL 6 DAY";
    } else {
      curWhere = "DATE(called_at) = CURDATE()";
      prevWhere = "DATE(called_at) = CURDATE() - INTERVAL 1 DAY";
    }

    const tallySql = (where) => `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN cs.name = 'Phone Picked' THEN 1 ELSE 0 END) AS connected,
        SUM(CASE WHEN cs.name = 'Not Picked' THEN 1 ELSE 0 END) AS no_answer,
        SUM(CASE WHEN cs.name = 'Wrong Number' THEN 1 ELSE 0 END) AS wrong_number,
        SUM(CASE WHEN cs.name = 'Rudely Behaved' THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN c.is_follow_up_required = 1 THEN 1 ELSE 0 END) AS follow_ups
      FROM calls c
      LEFT JOIN call_statuses cs ON cs.id = c.status_id
      WHERE ${where} ${scope.where}
    `;
    const [[cur]] = await query(tallySql(curWhere), scope.params).then((r) => [r]);
    const [[prev]] = await query(tallySql(prevWhere), scope.params).then((r) => [r]);

    // Contact funnel — scope by contacts.district_id where applicable.
    const cScope = scopeFilterSync(session.user, "ct");
    const [[funnel]] = await query(
      `SELECT
         (SELECT COUNT(*) FROM contacts ct WHERE 1=1 ${cScope.where}) AS total_contacts,
         (SELECT COUNT(*) FROM contacts ct WHERE assigned_to_user_id IS NOT NULL ${cScope.where}) AS assigned,
         (SELECT COUNT(*) FROM contacts ct WHERE id IN (SELECT DISTINCT contact_id FROM calls WHERE contact_id IS NOT NULL) ${cScope.where}) AS attempted,
         (SELECT COUNT(*) FROM contacts ct WHERE is_completed = 1 ${cScope.where}) AS completed`,
      [...cScope.params, ...cScope.params, ...cScope.params, ...cScope.params]
    ).then((r) => [r]);

    // Live strip — apply scope to calls + contacts (online users isn't easily scoped, kept global).
    const callScope = scopeFilterSync(session.user, "c");
    const contactScope = scopeFilterSync(session.user, "ct");
    const [[live]] = await query(
      `SELECT
         (SELECT COUNT(*) FROM users
            WHERE role IN ('caller','user','agent')
              AND last_seen_at >= NOW() - INTERVAL ${LIVE_THRESHOLD_SECONDS} SECOND) AS online,
         (SELECT COUNT(*) FROM calls c WHERE called_at >= NOW() - INTERVAL 1 HOUR ${callScope.where}) AS last_hour,
         (SELECT COUNT(*) FROM contacts ct
            WHERE assigned_to_user_id IS NULL
              AND is_completed = 0
              AND (locked_by_user_id IS NULL OR locked_at < NOW() - INTERVAL 10 MINUTE) ${contactScope.where}) AS pool_available,
         (SELECT COUNT(*) FROM calls c
            WHERE is_follow_up_required = 1
              AND follow_up_date IS NOT NULL
              AND follow_up_date < CURDATE() ${callScope.where}) AS overdue_follow_ups`,
      [...callScope.params, ...contactScope.params, ...callScope.params]
    ).then((r) => [r]);

    // Top districts by progress (completed / total) — scope to the admin's territory.
    const dScope = scopeFilterSync(session.user, "c");
    const districts = await query(
      `SELECT
         l.id, l.name,
         COUNT(c.id) AS contacts,
         SUM(CASE WHEN c.is_completed = 1 THEN 1 ELSE 0 END) AS completed
       FROM locations l
       LEFT JOIN contacts c ON c.district_id = l.id ${dScope.where ? `AND ${dScope.where.replace(/^AND /, "")}` : ""}
       WHERE l.type = 'district'
       GROUP BY l.id, l.name
       HAVING contacts > 0
       ORDER BY contacts DESC
       LIMIT 8`,
      dScope.params
    );

    // Calls-over-time chart (last 7 days regardless of range — gives admin context).
    const tScope = scopeFilterSync(session.user, "c");
    const timeline = await query(
      `SELECT DATE(called_at) AS day, COUNT(*) AS n
         FROM calls c
        WHERE called_at >= CURDATE() - INTERVAL 6 DAY ${tScope.where}
        GROUP BY DATE(called_at)
        ORDER BY day ASC`,
      tScope.params
    );

    return NextResponse.json({
      range,
      tally: {
        cur: numerify(cur),
        prev: numerify(prev),
      },
      funnel: numerify(funnel),
      live: numerify(live),
      districts,
      timeline,
    });
  } catch (err) {
    console.error("admin/overview error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// MySQL returns counts/sums as strings sometimes; convert to numbers.
function numerify(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = v == null ? 0 : Number(v);
  return out;
}
