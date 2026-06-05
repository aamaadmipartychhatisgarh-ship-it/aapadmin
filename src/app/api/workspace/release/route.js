import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

// Releases any lock the caller is currently holding without logging a call.
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    await query(
      `UPDATE contacts SET locked_by_user_id = NULL, locked_at = NULL WHERE locked_by_user_id = ?`,
      [session.user.id]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("workspace release error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
