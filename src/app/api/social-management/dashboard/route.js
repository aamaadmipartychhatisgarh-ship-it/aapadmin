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
export async function GET(req) {
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

    // Selected day for the Page-wise Daily Post Status (BUG 5): a ?date=YYYY-MM-DD
    // calendar date, defaulting to TODAY (app/IST convention via resolveRange).
    const dateParam = new URL(req.url).searchParams.get("date");
    const day = /^\d{4}-\d{2}-\d{2}$/.test(dateParam || "")
      ? dateParam
      : String(resolveRange("today").from).slice(0, 10);

    // ALL active pages (LEFT JOIN → pages with zero posts on the day still appear
    // with a 0 count), with that day's post breakdown. Page names come straight
    // from the master (sp.handle); counts come from the real post records.
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
        ORDER BY sp.platform, sp.lok_sabha_name, sp.handle`,
      [day, ...lsParams]
    );

    const cast = (p) => ({
      id: p.id, platform: p.platform, handle: p.handle, lok_sabha_name: p.lok_sabha_name,
      total_posts: Number(p.total_posts), scheduled_posts: Number(p.scheduled_posts),
      published_posts: Number(p.published_posts), failed_posts: Number(p.failed_posts),
      engagement: Number(p.views) + Number(p.likes) + Number(p.comments) + Number(p.shares),
      // DONE = at least one PUBLISHED post that day. A scheduled-only day is NOT
      // done (§8). Pages with zero posts are not done.
      done: Number(p.published_posts) >= 1,
    });
    const rows = pages.map(cast);

    // Headline metrics (BUG 4) — all-time across the scoped pages, independent of
    // the yesterday window above. Refresh-safe (all from the DB), and they move as
    // posts are added/edited and their status changes.
    const [[postAgg]] = await query(
      `SELECT COUNT(*) AS total_posts,
              COALESCE(SUM(p.publish_status = 'scheduled'), 0) AS scheduled_posts
         FROM social_posts p JOIN social_pages sp ON sp.id = p.page_id
        WHERE sp.is_active = 1 ${lsFilter}`,
      lsParams
    );
    // Follower totals per platform = SUM of that platform's page followers (the
    // app's defined aggregation — never one page's number).
    const folRows = await query(
      `SELECT sp.platform, COALESCE(SUM(sp.followers), 0) AS followers
         FROM social_pages sp
        WHERE sp.is_active = 1 ${lsFilter}
        GROUP BY sp.platform`,
      lsParams
    );
    const byPlatform = {};
    for (const r of folRows) byPlatform[r.platform] = Number(r.followers) || 0;
    const headline = {
      total_posts: Number(postAgg?.total_posts) || 0,
      scheduled_posts: Number(postAgg?.scheduled_posts) || 0,
      followers: {
        facebook: byPlatform.facebook || 0,
        instagram: byPlatform.instagram || 0,
        twitter: byPlatform.twitter || 0,
      },
    };

    const totalsFor = (list) => list.reduce((t, p) => ({
      pages: t.pages + 1, total_posts: t.total_posts + p.total_posts,
      scheduled_posts: t.scheduled_posts + p.scheduled_posts, published_posts: t.published_posts + p.published_posts,
      failed_posts: t.failed_posts + p.failed_posts, engagement: t.engagement + p.engagement,
    }), { pages: 0, total_posts: 0, scheduled_posts: 0, published_posts: 0, failed_posts: 0, engagement: 0 });

    return NextResponse.json({
      date: day,
      headline,
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
