import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, scopeFilterSync, normalizeRole, ROLES } from "@/lib/permissions";
import { query } from "@/lib/db";
import { contactsByDistrict } from "@/lib/workerCounts";
import { requiredWorkersFor } from "@/lib/chhattisgarhAssemblies";

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
    // Area Ranking: districts ranked by STRENGTH % = actual workers / required
    // workers x 100. Actual workers come from Contacts (the same shared helper
    // the Strength page uses); required is the fixed per-district target (same
    // source). The raw worker count is intentionally NOT surfaced here — only
    // the percentage. Guards: required=0 -> 0% (never NaN/Infinity), clamped to
    // 0..100. District names come from the master `locations` rows (exact).
    const [districtRows, contactCounts] = await Promise.all([
      query(
        `SELECT ld.id, ld.name AS district_name
           FROM locations ld
          WHERE ld.type = 'district' ${districtFilter}`,
        dParams
      ),
      contactsByDistrict(),
    ]);
    const areaRankings = districtRows
      .map((d) => {
        const workers = contactCounts.get(d.id) || 0;
        const required = requiredWorkersFor(d.district_name);
        const strength_pct = required > 0 ? Math.min(100, Math.max(0, Math.round((workers / required) * 100))) : 0;
        return { id: d.id, district_name: d.district_name, strength_pct, _workers: workers };
      })
      // Only rank districts that actually have workers; sort by the percentage.
      .filter((d) => d._workers > 0)
      .sort((a, b) => b.strength_pct - a.strength_pct || a.district_name.localeCompare(b.district_name))
      .map(({ id, district_name, strength_pct }) => ({ id, district_name, strength_pct }));

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
