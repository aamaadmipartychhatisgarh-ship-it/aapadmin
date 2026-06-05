import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";

// Create a manual post log entry. status starts as 'pending' (or 'draft').
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const d = await req.json();
    if (!d.page_id) return NextResponse.json({ message: "page_id required" }, { status: 400 });
    const res = await query(
      `INSERT INTO social_posts (
         page_id, title, caption, post_type, media_url, external_url,
         scheduled_at, posted_at, approval_status,
         views, likes, comments, shares, reach, viral,
         created_by_user_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.page_id, d.title || null, d.caption || null, d.post_type || "post",
        d.media_url || null, d.external_url || null,
        d.scheduled_at || null, d.posted_at || null,
        d.approval_status || "pending",
        Number(d.views) || 0, Number(d.likes) || 0, Number(d.comments) || 0,
        Number(d.shares) || 0, Number(d.reach) || 0,
        d.viral ? 1 : 0,
        session.user.id,
      ]
    );
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("social posts POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
