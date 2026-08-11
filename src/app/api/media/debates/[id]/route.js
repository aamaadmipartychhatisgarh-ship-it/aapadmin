import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const d = await req.json();
    const fields = ["channel_id", "topic", "debate_date", "debate_time", "brief_pdf_url", "talking_points", "opposition_counter", "status", "viral_score"];
    const sets = [], vals = [];
    for (const f of fields) if (f in d) { sets.push(`${f} = ?`); vals.push(d[f] === "" ? null : d[f]); }
    const hasSpokes = Array.isArray(d.spokesperson_ids);
    if (!sets.length && !hasSpokes) return NextResponse.json({ message: "No changes to save." }, { status: 400 });

    if (sets.length) {
      vals.push(id);
      await query(`UPDATE debates SET ${sets.join(", ")} WHERE id = ?`, vals);
    }

    // Sync the spokesperson relationships to exactly the provided set: drop the
    // ones removed, add the new ones (INSERT IGNORE + the UNIQUE key prevent any
    // duplicate assignment). Existing rows are kept so their alert flags survive.
    if (hasSpokes) {
      const ids = [...new Set(d.spokesperson_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
      if (ids.length) {
        await query(
          `DELETE FROM debate_assignments WHERE debate_id = ? AND spokesperson_id NOT IN (${ids.map(() => "?").join(",")})`,
          [id, ...ids]
        );
        for (const sid of ids) {
          await query(`INSERT IGNORE INTO debate_assignments (debate_id, spokesperson_id) VALUES (?, ?)`, [id, sid]);
        }
      } else {
        await query(`DELETE FROM debate_assignments WHERE debate_id = ?`, [id]);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("debate PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    await query("DELETE FROM debates WHERE id = ?", [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("debate DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
