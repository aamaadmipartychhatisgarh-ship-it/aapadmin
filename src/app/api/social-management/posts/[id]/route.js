import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessSocial } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query, getPool } from "@/lib/db";
import { ensureSocialPostSchema, normalizeDestinations } from "@/lib/socialPostSchema";
import { resolveDestinations, syncPostDestinations } from "@/lib/socialDestinations";

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "social_management", session && canAccessSocial(session)))) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensureSocialPostSchema();
    const { id } = await params;
    const d = await req.json();

    // Resolve destinations up-front (if provided) so a bad set fails before any
    // write — nothing is partially saved (§8).
    let destRows = null;
    if (Array.isArray(d.destinations)) {
      const { rows, error } = await resolveDestinations(normalizeDestinations(d.destinations));
      if (error) return NextResponse.json({ message: error }, { status: 400 });
      destRows = rows;
    }

    const fields = ["title", "caption", "post_type", "media_url", "external_url",
      "scheduled_at", "posted_at", "approval_status", "publish_status",
      "views", "likes", "comments", "shares", "reach", "viral"];
    const sets = [], vals = [];
    for (const f of fields) if (f in d) { sets.push(`${f} = ?`); vals.push(d[f] === "" ? null : d[f]); }
    if (d.approval_status === "approved") { sets.push("approved_by_user_id = ?"); vals.push(session.user.id); }
    // Keep the post's mirror page_id/external_url aligned with the first
    // destination when destinations are being updated.
    if (destRows && destRows.length) {
      sets.push("page_id = ?"); vals.push(destRows[0].page_id);
      sets.push("external_url = ?"); vals.push(destRows[0].post_link || null);
    }

    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      if (sets.length) {
        await conn.query(`UPDATE social_posts SET ${sets.join(", ")} WHERE id = ?`, [...vals, id]);
      }
      if (destRows) await syncPostDestinations(conn, Number(id), destRows); // diff-sync (§10/§11)
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("social post PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "social_management", session && canAccessSocial(session)))) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    // Remove the post and its destinations together.
    await query(`DELETE FROM social_post_destinations WHERE post_id = ?`, [id]);
    await query(`DELETE FROM social_posts WHERE id = ?`, [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("social post DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
