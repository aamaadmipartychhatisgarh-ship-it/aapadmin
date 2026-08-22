import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessSocial } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessSocial(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const d = await req.json();
    // If the name/platform is being edited, keep page names unique per platform.
    if ("handle" in d || "platform" in d) {
      const [cur] = await query("SELECT platform, handle FROM social_pages WHERE id = ?", [id]);
      const platform = "platform" in d ? String(d.platform || "").trim().toLowerCase() : cur?.platform;
      const handle = "handle" in d ? String(d.handle || "").replace(/\s+/g, " ").trim() : cur?.handle;
      if (handle) {
        const [dup] = await query(
          "SELECT id FROM social_pages WHERE platform = ? AND LOWER(handle) = LOWER(?) AND id <> ? LIMIT 1",
          [platform, handle, id]
        );
        if (dup) return NextResponse.json({ message: `"${handle}" already exists under ${platform}.` }, { status: 409 });
      }
    }
    const fields = ["lok_sabha_id", "lok_sabha_name", "platform", "handle", "url", "followers", "managed_by_user_id", "is_active"];
    const sets = [], vals = [];
    for (const f of fields) if (f in d) { sets.push(`${f} = ?`); vals.push(d[f] === "" ? null : d[f]); }
    if (!sets.length) return NextResponse.json({ message: "No fields" }, { status: 400 });
    vals.push(id);
    await query(`UPDATE social_pages SET ${sets.join(", ")} WHERE id = ?`, vals);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("social-page PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessSocial(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    await query("DELETE FROM social_pages WHERE id = ?", [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("social-page DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
