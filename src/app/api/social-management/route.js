import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { normalizeRole, ROLES, canAccessSocial } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { ensureSocialPageSchema } from "@/lib/socialPageSchema";
import { ensureSocialPostSchema } from "@/lib/socialPostSchema";
import { destinationsByPost } from "@/lib/socialDestinations";

// Aggregate data for the Social Management page (overview + per-LS rollups).
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "social_management", session && canAccessSocial(session)))) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    // Make sure the DP column + destinations table exist.
    await ensureSocialPageSchema();
    await ensureSocialPostSchema();

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
              (SELECT COUNT(DISTINCT d.post_id) FROM social_post_destinations d JOIN social_posts p ON p.id = d.post_id WHERE d.page_id = sp.id AND p.approval_status='approved') AS post_count,
              (SELECT COUNT(DISTINCT d.post_id) FROM social_post_destinations d JOIN social_posts p ON p.id = d.post_id WHERE d.page_id = sp.id AND DATE(COALESCE(p.posted_at, p.created_at)) = CURDATE()) AS today_posts,
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

    // Search-card metrics. The four platform cards (PROMPT 5) come straight
    // from the live records — today's Facebook/Instagram post counts from the
    // actual logged posts (social_posts joined to their page's platform, dated
    // to CURDATE), and the per-platform follower totals summed from the pages'
    // Followers Master (social_pages.followers). Nothing hardcoded; each refetch
    // reflects the current DB state. Legacy aggregate fields are kept for other
    // consumers.
    const f = lsFilter.replace(/sp\./g, "sp2.");
    const [[overview]] = await query(
      `SELECT COALESCE(SUM(followers),0) AS total_followers,
              COUNT(*) AS active_pages,
              (SELECT COALESCE(SUM(p.views),0) FROM social_posts p JOIN social_pages sp2 ON sp2.id=p.page_id WHERE 1=1 ${f}) AS total_views,
              (SELECT COUNT(*) FROM social_posts p JOIN social_pages sp2 ON sp2.id=p.page_id WHERE viral = 1 ${f}) AS viral_posts,
              (SELECT COUNT(*) FROM social_posts p JOIN social_pages sp2 ON sp2.id=p.page_id WHERE approval_status='pending' ${f}) AS pending_posts,
              (SELECT COUNT(*) FROM social_posts p JOIN social_pages sp2 ON sp2.id=p.page_id WHERE DATE(COALESCE(posted_at, p.created_at)) = CURDATE() ${f}) AS today_uploads,
              (SELECT COUNT(DISTINCT d.post_id) FROM social_post_destinations d JOIN social_pages sp2 ON sp2.id=d.page_id JOIN social_posts p ON p.id=d.post_id WHERE sp2.platform='facebook'  AND DATE(COALESCE(p.posted_at, p.created_at)) = CURDATE() ${f}) AS fb_today_posts,
              (SELECT COUNT(DISTINCT d.post_id) FROM social_post_destinations d JOIN social_pages sp2 ON sp2.id=d.page_id JOIN social_posts p ON p.id=d.post_id WHERE sp2.platform='instagram' AND DATE(COALESCE(p.posted_at, p.created_at)) = CURDATE() ${f}) AS ig_today_posts,
              (SELECT COALESCE(SUM(sp2.followers),0) FROM social_pages sp2 WHERE sp2.is_active=1 AND sp2.platform='facebook'  ${f}) AS fb_followers,
              (SELECT COALESCE(SUM(sp2.followers),0) FROM social_pages sp2 WHERE sp2.is_active=1 AND sp2.platform='instagram' ${f}) AS ig_followers
         FROM social_pages sp WHERE is_active = 1 ${lsFilter}`,
      [...lsParams, ...lsParams, ...lsParams, ...lsParams, ...lsParams, ...lsParams, ...lsParams, ...lsParams, ...lsParams]
    ).then((r) => [r]);

    // Attach each post's platform/page destinations (with per-page links) so the
    // Post List can show every destination, and Edit can repopulate them (§10/§12).
    const dmap = await destinationsByPost(recentPosts.map((p) => p.id));
    for (const p of recentPosts) p.destinations = dmap[p.id] || [];

    return NextResponse.json({ pages, recentPosts, pending, overview });
  } catch (err) {
    console.error("social-management GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
