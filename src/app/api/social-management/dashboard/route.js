import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { normalizeRole, ROLES, canAccessSocial } from "@/lib/permissions";
import { query } from "@/lib/db";
import { resolveRange } from "@/lib/reports/timeRanges";

// GET /api/social-management/dashboard — per-page yesterday stats (Total/
// Scheduled/Published/Failed posts + engagement), grouped into Facebook/
// Instagram/Combined totals. Same role-based Lok-Sabha scoping as the main
// aggregate route (src/app/api/social-management/route.js) — duplicated
// rather than shared since that route doesn't export it, matching this
// module's existing self-contained-per-route convention.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessSocial(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

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

    const { from: yesterday } = resolveRange("yesterday");

    const pages = await query(
      `SELECT sp.id, sp.platform, sp.handle, sp.lok_sabha_name,
              COUNT(p.id) AS total_posts,
              SUM(CASE WHEN p.publish_status = 'scheduled' THEN 1 ELSE 0 END) AS scheduled_posts,
              SUM(CASE WHEN p.publish_status = 'published' THEN 1 ELSE 0 END) AS published_posts,
              SUM(CASE WHEN p.publish_status = 'failed' THEN 1 ELSE 0 END) AS failed_posts,
              COALESCE(SUM(p.views), 0) AS views, COALESCE(SUM(p.likes), 0) AS likes,
              COALESCE(SUM(p.comments), 0) AS comments, COALESCE(SUM(p.shares), 0) AS shares
         FROM social_pages sp
         LEFT JOIN social_posts p ON p.page_id = sp.id
              AND DATE(COALESCE(p.posted_at, p.scheduled_at, p.created_at)) = ?
        WHERE sp.is_active = 1 ${lsFilter}
        GROUP BY sp.id, sp.platform, sp.handle, sp.lok_sabha_name
        ORDER BY sp.platform, sp.lok_sabha_name`,
      [yesterday, ...lsParams]
    );

    const cast = (p) => ({
      id: p.id, platform: p.platform, handle: p.handle, lok_sabha_name: p.lok_sabha_name,
      total_posts: Number(p.total_posts), scheduled_posts: Number(p.scheduled_posts),
      published_posts: Number(p.published_posts), failed_posts: Number(p.failed_posts),
      engagement: Number(p.views) + Number(p.likes) + Number(p.comments) + Number(p.shares),
    });
    const rows = pages.map(cast);

    const totalsFor = (list) => list.reduce((t, p) => ({
      pages: t.pages + 1, total_posts: t.total_posts + p.total_posts,
      scheduled_posts: t.scheduled_posts + p.scheduled_posts, published_posts: t.published_posts + p.published_posts,
      failed_posts: t.failed_posts + p.failed_posts, engagement: t.engagement + p.engagement,
    }), { pages: 0, total_posts: 0, scheduled_posts: 0, published_posts: 0, failed_posts: 0, engagement: 0 });

    return NextResponse.json({
      pages: rows,
      totals: {
        facebook: totalsFor(rows.filter((p) => p.platform === "facebook")),
        instagram: totalsFor(rows.filter((p) => p.platform === "instagram")),
        combined: totalsFor(rows),
      },
    });
  } catch (err) {
    console.error("social-management dashboard error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
