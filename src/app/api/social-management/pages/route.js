import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessSocial } from "@/lib/permissions";
import { query } from "@/lib/db";

// The Social Media Master supports exactly these three networks (BUG 1). Kept in
// sync with the PLATFORM map in the social-management UI and the
// social_pages.platform enum.
export const ALLOWED_PLATFORMS = ["facebook", "instagram", "twitter"];

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessSocial(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const d = await req.json();
    // Platform is restricted to the three supported networks (Social Media
    // Master, BUG 1). Handle = the page name.
    const platform = String(d.platform || "").trim().toLowerCase();
    if (!ALLOWED_PLATFORMS.includes(platform)) {
      return NextResponse.json({ message: "Select a valid platform (Facebook, Instagram or Twitter/X)." }, { status: 400 });
    }
    const handle = String(d.handle || "").replace(/\s+/g, " ").trim();
    if (!handle) return NextResponse.json({ message: "Page name is required." }, { status: 400 });
    if (handle.length > 255) return NextResponse.json({ message: "Page name is too long (max 255 characters)." }, { status: 400 });

    // Prevent duplicate page names under the SAME platform (case-insensitive).
    // The same name on a different platform is allowed.
    const [dup] = await query(
      "SELECT id FROM social_pages WHERE platform = ? AND LOWER(handle) = LOWER(?) LIMIT 1",
      [platform, handle]
    );
    if (dup) return NextResponse.json({ message: `"${handle}" already exists under ${platform}.` }, { status: 409 });

    // Resolve lok_sabha_name if a location id was passed without name.
    let lokSabhaName = d.lok_sabha_name || null;
    if (d.lok_sabha_id && !lokSabhaName) {
      const [ls] = await query("SELECT name FROM locations WHERE id = ?", [d.lok_sabha_id]);
      lokSabhaName = ls?.name || null;
    }
    const res = await query(
      `INSERT INTO social_pages (lok_sabha_id, lok_sabha_name, platform, handle, url, followers, managed_by_user_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [d.lok_sabha_id || null, lokSabhaName, platform, handle, d.url || null,
       Number(d.followers) || 0, d.managed_by_user_id || null]
    );
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("social-pages POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
