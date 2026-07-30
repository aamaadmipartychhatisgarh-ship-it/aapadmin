import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

// Per-user sidebar layout preferences. The client stores a single JSON object
// keyed by menu href: { fav:[href], top:[href], bottom:[href], main:[href] }.
// No role logic here — role defaults live on the client; this just persists
// whatever the signed-in user arranged.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const rows = await query("SELECT prefs FROM sidebar_preferences WHERE user_id = ?", [session.user.id]);
    let prefs = null;
    if (rows[0]?.prefs) { try { prefs = JSON.parse(rows[0].prefs); } catch { prefs = null; } }
    return NextResponse.json({ prefs });
  } catch (err) {
    console.error("sidebar prefs GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const prefs = body?.prefs;
    if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) {
      return NextResponse.json({ message: "Invalid preferences" }, { status: 400 });
    }
    // Whitelist the shape so a client can't stuff arbitrary data in.
    const clean = {};
    for (const k of ["fav", "top", "bottom", "main"]) {
      clean[k] = Array.isArray(prefs[k]) ? prefs[k].filter((x) => typeof x === "string").slice(0, 200) : [];
    }
    await query(
      `INSERT INTO sidebar_preferences (user_id, prefs) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE prefs = VALUES(prefs)`,
      [session.user.id, JSON.stringify(clean)]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("sidebar prefs PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// Reset to the role default (remove the user's saved layout).
export async function DELETE() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await query("DELETE FROM sidebar_preferences WHERE user_id = ?", [session.user.id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("sidebar prefs DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
