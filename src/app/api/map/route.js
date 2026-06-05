import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, normalizeRole, ROLES } from "@/lib/permissions";
import { query } from "@/lib/db";

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

    const rows = await query(
      `SELECT ld.id, ld.name,
              lz.name AS zone_name,
              (SELECT COUNT(*) FROM workers w WHERE w.district_id = ld.id) AS worker_count,
              (SELECT COUNT(*) FROM workers w WHERE w.district_id = ld.id AND w.status='active') AS active_workers,
              (SELECT COALESCE(ROUND(AVG(w.activity_score)),0) FROM workers w WHERE w.district_id = ld.id) AS avg_activity,
              (SELECT COUNT(*) FROM teams t WHERE t.location_id = ld.id) AS team_count,
              (SELECT COUNT(*) FROM calls c WHERE c.district_id = ld.id) AS call_count
         FROM locations ld
         LEFT JOIN locations lls ON lls.id = ld.parent_id
         LEFT JOIN locations lz ON lz.id = lls.parent_id
        WHERE ld.type = 'district' ${districtFilter}
        ORDER BY lz.name, ld.name`,
      dParams
    );

    const maxWorker = Math.max(1, ...rows.map((r) => r.worker_count));
    const maxCall = Math.max(1, ...rows.map((r) => r.call_count));
    const districts = rows.map((r) => {
      const score = Math.round(
        (r.worker_count / maxWorker) * 100 * 0.4 +
        r.avg_activity * 0.4 +
        (r.call_count / maxCall) * 100 * 0.2
      );
      return {
        ...r,
        zone_name: r.zone_name || "Unzoned",
        score,
        band: score >= 60 ? "strong" : score >= 35 ? "medium" : "weak",
      };
    });

    return NextResponse.json({ districts });
  } catch (err) {
    console.error("map error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
