import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, normalizeRole, ROLES } from "@/lib/permissions";
import { query } from "@/lib/db";

// Organization strength score per district, combining:
//   worker count, avg activity, team coverage, calling performance.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    // Scope which districts the user sees: zone-admin → districts in that zone,
    // district-admin → only their district, assembly-admin → district of their assembly.
    const role = normalizeRole(session.user.role);
    const u = session.user;
    let districtFilter = "";
    const dParams = [];
    if (role === ROLES.ZONE_ADMIN && u.scope_zone_id) {
      // districts whose parent (lok_sabha) parent is the zone
      districtFilter = `AND ld.parent_id IN (SELECT id FROM locations WHERE type='lok_sabha' AND parent_id = ?)`;
      dParams.push(u.scope_zone_id);
    } else if (role === ROLES.DISTRICT_ADMIN && u.home_district_id) {
      districtFilter = `AND ld.id = ?`;
      dParams.push(u.home_district_id);
    } else if (role === ROLES.ASSEMBLY_ADMIN && u.scope_assembly_id) {
      // district that owns this assembly
      districtFilter = `AND ld.id = (SELECT parent_id FROM locations WHERE id = ?)`;
      dParams.push(u.scope_assembly_id);
    }

    const rows = await query(
      `SELECT ld.id, ld.name,
              (SELECT COUNT(*) FROM workers w WHERE w.district_id = ld.id) AS worker_count,
              (SELECT COALESCE(ROUND(AVG(w.activity_score)),0) FROM workers w WHERE w.district_id = ld.id) AS avg_activity,
              (SELECT COUNT(*) FROM teams t WHERE t.location_id = ld.id) AS team_count,
              (SELECT COUNT(*) FROM calls c WHERE c.district_id = ld.id) AS call_count,
              (SELECT COUNT(*) FROM calls c JOIN call_statuses cs ON cs.id=c.status_id
                 WHERE c.district_id = ld.id AND cs.name='Phone Picked') AS connected_count
         FROM locations ld
        WHERE ld.type = 'district' ${districtFilter}
        ORDER BY ld.name`,
      dParams
    );

    // Normalize each factor 0-100 across districts, then weighted composite.
    const max = {
      worker: Math.max(1, ...rows.map((r) => r.worker_count)),
      team: Math.max(1, ...rows.map((r) => r.team_count)),
      call: Math.max(1, ...rows.map((r) => r.call_count)),
    };
    const scored = rows.map((r) => {
      const workerScore = (r.worker_count / max.worker) * 100;
      const activityScore = r.avg_activity; // already 0-100
      const teamScore = (r.team_count / max.team) * 100;
      const callScore = (r.call_count / max.call) * 100;
      const connectRate = r.call_count > 0 ? (r.connected_count / r.call_count) * 100 : 0;
      // Weights: workers 30, activity 30, teams 15, calling volume 15, connect rate 10
      const score = Math.round(
        workerScore * 0.30 + activityScore * 0.30 + teamScore * 0.15 + callScore * 0.15 + connectRate * 0.10
      );
      const band = score >= 60 ? "strong" : score >= 35 ? "medium" : "weak";
      return {
        id: r.id, name: r.name, score, band,
        worker_count: r.worker_count, avg_activity: r.avg_activity,
        team_count: r.team_count, call_count: r.call_count,
      };
    }).sort((a, b) => b.score - a.score);

    const summary = {
      strong: scored.filter((s) => s.band === "strong").length,
      medium: scored.filter((s) => s.band === "medium").length,
      weak: scored.filter((s) => s.band === "weak").length,
    };

    return NextResponse.json({ areas: scored, summary });
  } catch (err) {
    console.error("strength error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
