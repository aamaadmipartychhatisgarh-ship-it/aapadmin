import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { normalizeRole, ROLES, canAccessSocial } from "@/lib/permissions";
import { query } from "@/lib/db";

// Aggregate data for the Social Management page (overview + per-LS rollups).
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessSocial(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    // Social pages are keyed by lok_sabha_id. Scope per role:
    //   zone_admin     → pages whose LS is in the zone
    //   district_admin → pages whose LS contains their district
    //   assembly_admin → pages whose LS contains the district that owns their assembly
    const role = normalizeRole(session.user.role);
    const u = session.user;
    let lsFilter = "";
    const lsParams = [];
    if (role === ROLES.ZONE_ADMIN && u.scope_zone_id) {
      lsFilter = "AND sp.lok_sabha_id IN (SELECT id FROM locations WHERE type='lok_sabha' AND parent_id = ?)";
      lsParams.push(u.scope_zone_id);
    } else if (role === ROLES.DISTRICT_ADMIN && u.home_district_id) {
      lsFilter = "AND sp.lok_sabha_id = (SELECT parent_id FROM locations WHERE id = ?)";
      lsParams.push(u.home_district_id);
    } else if (role === ROLES.ASSEMBLY_ADMIN && u.scope_assembly_id) {
      lsFilter = `AND sp.lok_sabha_id = (
        SELECT ld.parent_id FROM locations ld
        WHERE ld.id = (SELECT parent_id FROM locations WHERE id = ?)
      )`;
      lsParams.push(u.scope_assembly_id);
    }

    const pages = await query(
      `SELECT sp.*, u.username AS manager_name,
              (SELECT COUNT(*) FROM social_posts p WHERE p.page_id = sp.id AND p.approval_status='approved') AS post_count,
              (SELECT COALESCE(SUM(p.views),0)  FROM social_posts p WHERE p.page_id = sp.id) AS total_views,
              (SELECT COALESCE(SUM(p.reach),0)  FROM social_posts p WHERE p.page_id = sp.id) AS total_reach,
              (SELECT MAX(p.posted_at)          FROM social_posts p WHERE p.page_id = sp.id) AS last_posted_at
         FROM social_pages sp
         LEFT JOIN users u ON u.id = sp.managed_by_user_id
        WHERE sp.is_active = 1 ${lsFilter}`,
      lsParams
    );

    const recentPosts = await query(
      `SELECT p.*, sp.platform, sp.handle, sp.lok_sabha_name,
              u.username AS author_name
         FROM social_posts p
         LEFT JOIN social_pages sp ON sp.id = p.page_id
         LEFT JOIN users u ON u.id = p.created_by_user_id
        WHERE 1=1 ${lsFilter}
        ORDER BY COALESCE(p.posted_at, p.created_at) DESC
        LIMIT 50`,
      lsParams
    );

    const pending = await query(
      `SELECT p.id, p.title, p.post_type, p.created_at, p.media_url,
              sp.platform, sp.handle, sp.lok_sabha_name
         FROM social_posts p
         LEFT JOIN social_pages sp ON sp.id = p.page_id
        WHERE p.approval_status = 'pending' ${lsFilter}
        ORDER BY p.created_at DESC LIMIT 30`,
      lsParams
    );

    // Per-Lok-Sabha rollup — same scope.
    const perLs = await query(
      `SELECT sp.lok_sabha_name AS name,
              COUNT(DISTINCT sp.id) AS pages,
              COALESCE(SUM(sp.followers), 0) AS followers,
              (SELECT COUNT(*) FROM social_posts p
                 WHERE p.page_id IN (SELECT id FROM social_pages WHERE lok_sabha_id = sp.lok_sabha_id)
                   AND p.approval_status = 'approved') AS posts,
              (SELECT COALESCE(SUM(p.views), 0) FROM social_posts p
                 WHERE p.page_id IN (SELECT id FROM social_pages WHERE lok_sabha_id = sp.lok_sabha_id)) AS views
         FROM social_pages sp
        WHERE sp.lok_sabha_id IS NOT NULL ${lsFilter}
        GROUP BY sp.lok_sabha_id, sp.lok_sabha_name
        ORDER BY views DESC`,
      lsParams
    );

    const [[overview]] = await query(
      `SELECT COALESCE(SUM(followers),0) AS total_followers,
              COUNT(*) AS active_pages,
              (SELECT COALESCE(SUM(p.views),0) FROM social_posts p JOIN social_pages sp2 ON sp2.id=p.page_id WHERE 1=1 ${lsFilter.replace(/sp\./g, "sp2.")}) AS total_views,
              (SELECT COUNT(*) FROM social_posts p JOIN social_pages sp2 ON sp2.id=p.page_id WHERE viral = 1 ${lsFilter.replace(/sp\./g, "sp2.")}) AS viral_posts,
              (SELECT COUNT(*) FROM social_posts p JOIN social_pages sp2 ON sp2.id=p.page_id WHERE approval_status='pending' ${lsFilter.replace(/sp\./g, "sp2.")}) AS pending_posts,
              (SELECT COUNT(*) FROM social_posts p JOIN social_pages sp2 ON sp2.id=p.page_id WHERE DATE(COALESCE(posted_at, p.created_at)) = CURDATE() ${lsFilter.replace(/sp\./g, "sp2.")}) AS today_uploads
         FROM social_pages sp WHERE is_active = 1 ${lsFilter}`,
      [...lsParams, ...lsParams, ...lsParams, ...lsParams, ...lsParams]
    ).then((r) => [r]);

    return NextResponse.json({ pages, recentPosts, pending, perLs, overview });
  } catch (err) {
    console.error("social-management GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
