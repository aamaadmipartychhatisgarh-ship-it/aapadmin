import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    await query("UPDATE users SET last_seen_at = NOW() WHERE id = ?", [session.user.id]);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("heartbeat error:", err);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
