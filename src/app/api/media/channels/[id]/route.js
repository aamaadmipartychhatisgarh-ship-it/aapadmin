import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureNewsChannelsSeed } from "@/lib/newsChannelsSeed";

// BUG 24 — Edit a news channel (name + Lok Sabha + optional tone/contacts). Lok
// Sabha is now editable (it wasn't before): validated against the master.
export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensureNewsChannelsSeed(); // ensure lok_sabha_id column exists
    const { id } = await params;
    const d = await req.json().catch(() => ({}));

    const sets = [], vals = [];
    if ("name" in d) {
      const name = String(d.name ?? "").trim();
      if (!name) return NextResponse.json({ message: "Channel name is required." }, { status: 400 });
      sets.push("name = ?"); vals.push(name);
    }
    if ("lok_sabha_id" in d) {
      if (d.lok_sabha_id == null || d.lok_sabha_id === "" || !/^\d+$/.test(String(d.lok_sabha_id))) {
        return NextResponse.json({ message: "Please select a Lok Sabha." }, { status: 400 });
      }
      const lokSabhaId = Number(d.lok_sabha_id);
      const [ls] = await query("SELECT id FROM locations WHERE id = ? AND type = 'lok_sabha'", [lokSabhaId]);
      if (!ls) return NextResponse.json({ message: "The selected Lok Sabha no longer exists. Refresh and try again." }, { status: 400 });
      sets.push("lok_sabha_id = ?"); vals.push(lokSabhaId);
    }
    for (const f of ["contact_email", "contact_phone", "tone", "sort_order"]) {
      if (f in d) { sets.push(`${f} = ?`); vals.push(d[f] === "" ? null : d[f]); }
    }
    if (!sets.length) return NextResponse.json({ message: "No fields to update." }, { status: 400 });

    const exists = await query("SELECT id FROM news_channels WHERE id = ?", [id]);
    if (!exists.length) return NextResponse.json({ message: "That channel no longer exists." }, { status: 404 });

    vals.push(id);
    try {
      await query(`UPDATE news_channels SET ${sets.join(", ")} WHERE id = ?`, vals);
    } catch (e) {
      if (e && (e.code === "ER_DUP_ENTRY" || e.errno === 1062)) {
        return NextResponse.json({ message: "Another channel with this name already exists." }, { status: 409 });
      }
      throw e;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("channel PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// BUG 24 — Delete a channel. To keep debate data intact (§6/§7), deletion is
// blocked while debates are still linked to the channel; the debates are never
// touched. Delete only once the channel has no linked debates.
export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    const [cnt] = await query("SELECT COUNT(*) AS n FROM debates WHERE channel_id = ?", [id]);
    const n = Number(cnt?.n || 0);
    if (n > 0) {
      return NextResponse.json(
        { message: `This channel has ${n} debate${n === 1 ? "" : "s"} linked to it. Remove or reassign them from its Debate List before deleting.` },
        { status: 409 }
      );
    }
    const res = await query("DELETE FROM news_channels WHERE id = ?", [id]);
    if (!res.affectedRows) return NextResponse.json({ message: "Channel not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("channel DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
