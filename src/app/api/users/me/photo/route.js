import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

// PUT /api/users/me/photo  { url: string | null }
// Self-service: a user can only ever set their OWN photo_url — deliberately a
// separate, narrow endpoint rather than reusing the admin user-edit route, so
// this never grants a caller write access to admin-only fields like role.
export async function PUT(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { url } = await req.json().catch(() => ({}));
    await query("UPDATE users SET photo_url = ? WHERE id = ?", [url || null, session.user.id]);
    return NextResponse.json({ ok: true, photo_url: url || null });
  } catch (err) {
    console.error("user self photo update error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
