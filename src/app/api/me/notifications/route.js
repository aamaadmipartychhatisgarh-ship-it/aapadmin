import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

// GET: recent notifications for the signed-in user (newest first) + unread count.
// The `notifications` table has existed since the org-modules migration, so no
// feature-detection is needed here.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const userId = session.user.id;

    const notifications = await query(
      `SELECT id, type, severity, title, body, link, is_read, created_at
         FROM notifications
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 50`,
      [userId]
    );
    const [{ unread }] = await query(
      "SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0",
      [userId]
    );
    return NextResponse.json({ notifications, unread: Number(unread) || 0 });
  } catch (err) {
    console.error("me/notifications GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// POST { ids?: number[], all?: true } : mark notifications read for this user.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const userId = session.user.id;
    const { ids, all } = await req.json().catch(() => ({}));

    if (all) {
      await query("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0", [userId]);
    } else if (Array.isArray(ids) && ids.length) {
      const placeholders = ids.map(() => "?").join(", ");
      await query(
        `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id IN (${placeholders})`,
        [userId, ...ids]
      );
    } else {
      return NextResponse.json({ message: "Nothing to mark" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("me/notifications POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
