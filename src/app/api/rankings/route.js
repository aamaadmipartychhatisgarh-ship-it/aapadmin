import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, scopeFilterSync } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { districtWorkerStats } from "@/lib/districtStats";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "rankings", session && isOversight(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

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

    // Area Ranking — PERCENTAGE ONLY. From the ONE shared district-stats service
    // (same numbers as Strength / tree map / Organization Map). Strength % =
    // actual Contacts workers / required workers × 100 (guarded 0..100). The raw
    // worker/required counts are intentionally NOT surfaced here. Only districts
    // that actually have workers are ranked; sorted highest → lowest %, then by
    // district name as a stable tie-breaker.
    const areaRankings = (await districtWorkerStats(session))
      .filter((d) => d.actualWorkers > 0)
      .sort((a, b) => b.strengthPercentage - a.strengthPercentage || a.district.localeCompare(b.district))
      .map((d) => ({ id: d.id, district_name: d.district, strength_pct: d.strengthPercentage }));

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
