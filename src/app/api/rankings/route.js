import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, scopeFilterSync, normalizeRole, ROLES } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    // Geographic scope on workers (top performers within the admin's territory).
    const wScope = scopeFilterSync(session.user, "w");
    const topWorkers = await query(
      `SELECT w.id, w.name, w.position, w.activity_score, ld.name AS district_name,
              (SELECT COUNT(*) FROM worker_badges wb WHERE wb.worker_id = w.id) AS badge_count
         FROM workers w
         LEFT JOIN locations ld ON ld.id = w.district_id
        WHERE w.status = 'active' ${wScope.where}
        ORDER BY w.activity_score DESC
        LIMIT 20`,
      wScope.params
    );

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
