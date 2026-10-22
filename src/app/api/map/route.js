import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, normalizeRole, ROLES } from "@/lib/permissions";
import { query } from "@/lib/db";
import { notWrongNumberClause, notPendingClause } from "@/lib/contactExtras";
import { districtWorkerStats } from "@/lib/districtStats";
import { callsUnion } from "@/lib/allCalls";

// District-level map data: strength score + drill-down details per district,
// grouped by zone. Scoped per role: zone-admins see their zone, etc.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const role = normalizeRole(session.user.role);
    const u = session.user;
    let districtFilter = "";
    const dParams = [];
    if (role === ROLES.ZONE_ADMIN && u.scope_zone_id) {
      districtFilter = `AND lz.id = ?`;
      dParams.push(u.scope_zone_id);
    } else if (role === ROLES.DISTRICT_ADMIN && u.home_district_id) {
      districtFilter = `AND ld.id = ?`;
      dParams.push(u.home_district_id);
    } else if (role === ROLES.ASSEMBLY_ADMIN && u.scope_assembly_id) {
      districtFilter = `AND ld.id = (SELECT parent_id FROM locations WHERE id = ?)`;
      dParams.push(u.scope_assembly_id);
    }

    // Every worker/contact figure comes from live, correctly-mapped sources
    // keyed by district_id — the legacy `workers` table (Worker Management was
    // removed) is intentionally NOT used here, so the Map, the Workers-by-
    // District treemap, Strength and Area Ranking all agree.
    const notWrong = (await notWrongNumberClause("ct")) + (await notPendingClause("ct"));
    // Calls = Regular + Unfiltered (lib/allCalls); completion % likewise counts
    // completed Regular contacts + completed Unfiltered Contacts of the district.
    const src = await callsUnion({ where: " AND c.district_id IS NOT NULL" });
    const [rows, stats] = await Promise.all([
      query(
      `SELECT ld.id, ld.name,
              lz.name AS zone_name,
              (SELECT COUNT(*) FROM teams t WHERE t.location_id = ld.id) AS team_count,
              COALESCE(cc.n, 0) AS call_count,
              (SELECT COUNT(*) FROM users u WHERE u.role='caller' AND u.home_district_id = ld.id) AS caller_count,
              ROUND(COALESCE(
                ((SELECT COALESCE(SUM(ct.is_completed), 0) FROM contacts ct WHERE ct.district_id = ld.id${notWrong})
                 + (SELECT COUNT(*) FROM unfiltered_contacts uf WHERE uf.district_id = ld.id AND uf.completed_at IS NOT NULL))
                / NULLIF((SELECT COUNT(*) FROM contacts ct WHERE ct.district_id = ld.id${notWrong})
                 + (SELECT COUNT(*) FROM unfiltered_contacts uf WHERE uf.district_id = ld.id), 0) * 100, 0)) AS call_completion_pct
         FROM locations ld
         LEFT JOIN (SELECT c.district_id, COUNT(*) AS n FROM ${src.sql} c GROUP BY c.district_id) cc ON cc.district_id = ld.id
         LEFT JOIN locations lls ON lls.id = ld.parent_id
         LEFT JOIN locations lz ON lz.id = lls.parent_id
        WHERE ld.type = 'district' ${districtFilter}
        ORDER BY lz.name, ld.name`,
        [...src.params, ...dParams]
      ),
      districtWorkerStats(session),
    ]);

    // Worker count, required target and Strength % per district all come from the
    // ONE shared district-stats service — the SAME numbers the Workers-by-
    // District tree map, Strength and Area Ranking use, so every module agrees.
    // Districts with no contacts correctly show 0 (and every district appears);
    // a NULL/invalid district on a contact simply isn't mapped here (no crash).
    const statById = new Map(stats.map((s) => [s.id, s]));
    const districts = rows.map((r) => {
      const s = statById.get(r.id);
      const workers = s ? s.actualWorkers : 0;
      return {
        ...r,
        worker_count: workers,
        // Contacts ARE the workers in this app; surface the SAME single-source
        // count so the map's "Workers" and "Contacts" figures never disagree.
        contact_count: workers,
        required_workers: s ? s.requiredWorkers : 0,
        strength_pct: s ? s.strengthPercentage : 0,
        zone_name: r.zone_name || "Unzoned",
      };
    });

    return NextResponse.json({ districts });
  } catch (err) {
    console.error("map error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
