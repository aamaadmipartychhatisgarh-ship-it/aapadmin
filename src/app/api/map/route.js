import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, normalizeRole, ROLES } from "@/lib/permissions";
import { query } from "@/lib/db";
import { notWrongNumberClause } from "@/lib/contactExtras";
import { contactsByDistrict } from "@/lib/workerCounts";

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
    const notWrong = await notWrongNumberClause("ct");
    const [rows, contactCounts] = await Promise.all([
      query(
      `SELECT ld.id, ld.name,
              lz.name AS zone_name,
              (SELECT COUNT(*) FROM teams t WHERE t.location_id = ld.id) AS team_count,
              (SELECT COUNT(*) FROM calls c WHERE c.district_id = ld.id) AS call_count,
              (SELECT COUNT(*) FROM contacts ct WHERE ct.district_id = ld.id${notWrong}) AS contact_count,
              (SELECT COUNT(*) FROM users u WHERE u.role='caller' AND u.home_district_id = ld.id) AS caller_count,
              (SELECT ROUND(COALESCE(SUM(ct.is_completed) / NULLIF(COUNT(*), 0) * 100, 0))
                 FROM contacts ct WHERE ct.district_id = ld.id${notWrong}) AS call_completion_pct
         FROM locations ld
         LEFT JOIN locations lls ON lls.id = ld.parent_id
         LEFT JOIN locations lz ON lz.id = lls.parent_id
        WHERE ld.type = 'district' ${districtFilter}
        ORDER BY lz.name, ld.name`,
        dParams
      ),
      contactsByDistrict(),
    ]);

    // Worker count per district = ACTUAL Contacts (shared helper) — the SAME
    // number the Workers-by-District treemap, Strength and Area Ranking use, so
    // every module agrees. Drives the tile value, target completion % and the
    // hover/detail count; districts with no contacts correctly show 0, and a
    // NULL/invalid district on a contact simply isn't mapped here (no crash).
    const districts = rows.map((r) => ({
      ...r,
      worker_count: contactCounts.get(r.id) || 0,
      zone_name: r.zone_name || "Unzoned",
    }));

    return NextResponse.json({ districts });
  } catch (err) {
    console.error("map error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
