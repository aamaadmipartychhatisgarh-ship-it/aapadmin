import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensurePortalSchema } from "@/lib/portalAccounts";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// GET — announcements for the portal (any signed-in user may read).
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    await ensurePortalSchema();
    const rows = await query(
      `SELECT a.id, a.title, a.body, a.created_at,
              (SELECT username FROM users u WHERE u.id = a.created_by) AS created_by_name
         FROM announcements a ORDER BY a.id DESC LIMIT 200`
    );
    return NextResponse.json({ announcements: rows }, { headers: NO_STORE });
  } catch (err) {
    console.error("[announcements] GET:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

// POST — publish an announcement (oversight only).
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    await ensurePortalSchema();
    const d = await req.json().catch(() => ({}));
    const title = String(d?.title || "").trim();
    if (!title) return NextResponse.json({ message: "Title is required." }, { status: 400, headers: NO_STORE });
    const res = await query(
      `INSERT INTO announcements (title, body, created_by) VALUES (?, ?, ?)`,
      [title.slice(0, 200), String(d?.body || "").trim().slice(0, 5000) || null, session.user.id || null]
    );
    logAudit(session, { action: "announcement.create", entityType: "announcement", entityId: res.insertId, details: { title } });
    return NextResponse.json({ id: res.insertId }, { status: 201, headers: NO_STORE });
  } catch (err) {
    console.error("[announcements] POST:", err?.message || err);
    return NextResponse.json({ message: "Internal server error", detail: err?.sqlMessage || err?.message || null }, { status: 500, headers: NO_STORE });
  }
}
