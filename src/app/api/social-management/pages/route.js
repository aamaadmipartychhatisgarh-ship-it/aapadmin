import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessSocial } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessSocial(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const d = await req.json();
    if (!d.platform || !d.handle) return NextResponse.json({ message: "Platform and handle required" }, { status: 400 });
    // Resolve lok_sabha_name if a location id was passed without name.
    let lokSabhaName = d.lok_sabha_name || null;
    if (d.lok_sabha_id && !lokSabhaName) {
      const [ls] = await query("SELECT name FROM locations WHERE id = ?", [d.lok_sabha_id]);
      lokSabhaName = ls?.name || null;
    }
    const res = await query(
      `INSERT INTO social_pages (lok_sabha_id, lok_sabha_name, platform, handle, url, followers, managed_by_user_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [d.lok_sabha_id || null, lokSabhaName, d.platform, d.handle, d.url || null,
       Number(d.followers) || 0, d.managed_by_user_id || null]
    );
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("social-pages POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
