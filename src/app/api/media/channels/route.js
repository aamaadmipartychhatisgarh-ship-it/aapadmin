import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureNewsChannelsSeed } from "@/lib/newsChannelsSeed";

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensureNewsChannelsSeed(); // ensure the lok_sabha_id column exists
    const d = await req.json();
    const name = String(d?.name ?? "").trim();
    if (!name) return NextResponse.json({ message: "Channel name is required." }, { status: 400 });

    // Lok Sabha is required and must exist in the master (locations type='lok_sabha').
    if (d?.lok_sabha_id == null || d.lok_sabha_id === "" || !/^\d+$/.test(String(d.lok_sabha_id))) {
      return NextResponse.json({ message: "Please select a Lok Sabha." }, { status: 400 });
    }
    const lokSabhaId = Number(d.lok_sabha_id);
    const [ls] = await query("SELECT id FROM locations WHERE id = ? AND type = 'lok_sabha'", [lokSabhaId]);
    if (!ls) return NextResponse.json({ message: "The selected Lok Sabha no longer exists. Refresh and try again." }, { status: 400 });

    // Avoid accidental duplicate channels (same name).
    const [dup] = await query("SELECT id FROM news_channels WHERE name = ? LIMIT 1", [name]);
    if (dup) return NextResponse.json({ message: `“${name}” already exists in the channel list.` }, { status: 409 });

    let res;
    try {
      res = await query(
        `INSERT INTO news_channels (name, tone, sort_order, lok_sabha_id) VALUES (?, ?, ?, ?)`,
        [name, "unknown", Number(d.sort_order) || 0, lokSabhaId]
      );
    } catch (e) {
      if (e && (e.code === "ER_DUP_ENTRY" || e.errno === 1062)) {
        return NextResponse.json({ message: `“${name}” already exists in the channel list.` }, { status: 409 });
      }
      throw e;
    }
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("channels POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
