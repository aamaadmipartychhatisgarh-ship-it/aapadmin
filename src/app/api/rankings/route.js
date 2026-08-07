import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, scopeFilterSync, normalizeRole, ROLES } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    // Worker Membership Ranking — callers ranked by how many DISTINCT members
    // (contacts) they have registered. A "valid membership" is a contact the
    // caller recorded a positive / supporter outcome for; COUNT(DISTINCT
    // contact_id) means re-calling the same member never inflates the count
    // (duplicate handling). Scope is applied on the MEMBER's geography, so a
    // Super Admin sees every registration while a territory admin/supervisor
    // sees only members within their own area.
    //
    // Feature-detected so a lagging schema degrades instead of 500-ing:
    //   - no `sentiment` column  → count distinct members the caller engaged
    //   - no `contact_id` column → count positive calls (can't dedup by member)
    const callCols = await query(
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'calls'`
    ).then((rows) => new Set(rows.map((r) => r.name))).catch(() => new Set());
    const hasSentiment = callCols.has("sentiment");
    const hasContactId = callCols.has("contact_id");
    const validMembership = hasSentiment ? "AND c.sentiment IN ('positive','supporter')" : "";
    const memberCount = hasContactId ? "COUNT(DISTINCT c.contact_id)" : "COUNT(c.id)";
    // Scope the registered MEMBERS (contacts) to the admin's territory.
    const mScope = hasContactId ? scopeFilterSync(session.user, "ct") : { where: "", params: [] };
    const memberJoin = hasContactId ? "JOIN contacts ct ON ct.id = c.contact_id" : "";
    const ranked = hasContactId || hasSentiment
      ? await query(
          `SELECT u.id AS user_id, u.username AS name, ${memberCount} AS members
             FROM users u
             JOIN calls c ON c.user_id = u.id ${hasContactId ? "AND c.contact_id IS NOT NULL" : ""} ${validMembership}
             ${memberJoin}
            WHERE u.role IN ('caller','user','agent') ${mScope.where}
            GROUP BY u.id, u.username
           HAVING members > 0
            ORDER BY members DESC, u.username ASC
            LIMIT 50`,
          mScope.params
        )
      : [];
    // Competition ranking (1,1,3): equal member counts share a rank, the next
    // distinct count skips accordingly.
    let lastCount = null, lastRank = 0;
    const topWorkers = ranked.map((r, i) => {
      const members = Number(r.members) || 0;
      if (members !== lastCount) { lastRank = i + 1; lastCount = members; }
      return { user_id: r.user_id, name: r.name, members, rank: lastRank };
    });

    // Area rankings — limit to districts within the admin's territory.
    const role = normalizeRole(session.user.role);
    const u = session.user;
    let districtFilter = "";
    const dParams = [];
    if (role === ROLES.ZONE_ADMIN && u.scope_zone_id) {
      districtFilter = "AND ld.parent_id IN (SELECT id FROM locations WHERE type='lok_sabha' AND parent_id = ?)";
      dParams.push(u.scope_zone_id);
    } else if (role === ROLES.DISTRICT_ADMIN && u.home_district_id) {
      districtFilter = "AND ld.id = ?";
      dParams.push(u.home_district_id);
    } else if (role === ROLES.ASSEMBLY_ADMIN && u.scope_assembly_id) {
      districtFilter = "AND ld.id = (SELECT parent_id FROM locations WHERE id = ?)";
      dParams.push(u.scope_assembly_id);
    }
    const areaRankings = await query(
      `SELECT ld.id, ld.name AS district_name,
              COUNT(w.id) AS workers,
              ROUND(AVG(w.activity_score)) AS avg_activity
         FROM locations ld
         LEFT JOIN workers w ON w.district_id = ld.id
        WHERE ld.type = 'district' ${districtFilter}
        GROUP BY ld.id, ld.name
        HAVING workers > 0
        ORDER BY avg_activity DESC
        LIMIT 12`,
      dParams
    );

    const badges = await query(
      `SELECT b.name, b.color, b.icon, COUNT(wb.id) AS awarded
         FROM badges b LEFT JOIN worker_badges wb ON wb.badge_id = b.id
        GROUP BY b.id, b.name, b.color, b.icon`
    );

    return NextResponse.json({ topWorkers, areaRankings, badges });
  } catch (err) {
    console.error("rankings error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
