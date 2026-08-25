import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessSocial } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { getPool } from "@/lib/db";
import { ensureSocialPostSchema, normalizeDestinations } from "@/lib/socialPostSchema";
import { resolveDestinations, syncPostDestinations } from "@/lib/socialDestinations";

// Create ONE post with one or more platform/page destinations, each with its
// own post link (BUG 19). Body:
//   { caption, media_url, post_type, posted_at, publish_status, approval_status,
//     destinations: [{ platform, page_id, post_link }] }
// Back-compat: a legacy { page_id, external_url } is accepted as a single
// destination. The post row + all destinations are written in one transaction —
// nothing is partially saved (§8).
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "social_management", session && canAccessSocial(session)))) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensureSocialPostSchema();
    const d = await req.json();

    // Normalize + validate destinations (dedup by page, platform from the page).
    let incoming = Array.isArray(d.destinations) ? d.destinations : [];
    if (!incoming.length && d.page_id) incoming = [{ page_id: d.page_id, post_link: d.external_url }];
    const destinations = normalizeDestinations(incoming);
    const { rows, error } = await resolveDestinations(destinations);
    if (error) return NextResponse.json({ message: error }, { status: 400 });

    const conn = await getPool().getConnection();
    let postId;
    try {
      await conn.beginTransaction();
      // The post's own page_id/external_url mirror the FIRST destination so
      // legacy readers keep working; the full set lives in destinations.
      const first = rows[0];
      const [res] = await conn.query(
        `INSERT INTO social_posts (
           page_id, title, caption, post_type, media_url, external_url,
           scheduled_at, posted_at, approval_status, publish_status,
           views, likes, comments, shares, reach, viral, created_by_user_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          first.page_id, d.title || null, d.caption || null, d.post_type || "post",
          d.media_url || null, first.post_link || null,
          d.scheduled_at || null, d.posted_at || null,
          d.approval_status || "pending", d.publish_status || "published",
          Number(d.views) || 0, Number(d.likes) || 0, Number(d.comments) || 0,
          Number(d.shares) || 0, Number(d.reach) || 0,
          d.viral ? 1 : 0, session.user.id,
        ]
      );
      postId = res.insertId;
      await syncPostDestinations(conn, postId, rows);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    return NextResponse.json({ id: postId }, { status: 201 });
  } catch (err) {
    console.error("social posts POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
