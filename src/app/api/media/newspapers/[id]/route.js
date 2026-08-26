import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensurePressNotesSchema } from "@/lib/pressNotesSchema";

// BUG 21 — Edit a newspaper (name + Lok Sabha mapping + optional legacy fields).
// Lok Sabha is now editable (it wasn't before): "All" sets the flag, otherwise a
// specific master id is validated against locations(type='lok_sabha').
export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensurePressNotesSchema(); // ensure lok_sabha_* columns exist
    const { id } = await params;
    const d = await req.json().catch(() => ({}));

    const sets = [], vals = [];
    if ("name" in d) {
      const name = String(d.name ?? "").trim();
      if (!name) return NextResponse.json({ message: "Newspaper name is required." }, { status: 400 });
      sets.push("name = ?"); vals.push(name);
    }
    // Lok Sabha mapping — "All" flag or a specific Lok Sabha from the master.
    if ("lok_sabha_all" in d || "lok_sabha_id" in d) {
      const lokSabhaAll = d.lok_sabha_all === true || d.lok_sabha_id === "all";
      if (lokSabhaAll) {
        sets.push("lok_sabha_all = 1", "lok_sabha_id = NULL");
      } else {
        if (d.lok_sabha_id == null || d.lok_sabha_id === "" || !/^\d+$/.test(String(d.lok_sabha_id))) {
          return NextResponse.json({ message: "Please select a Lok Sabha (or choose “All”)." }, { status: 400 });
        }
        const lokSabhaId = Number(d.lok_sabha_id);
        const [ls] = await query("SELECT id FROM locations WHERE id = ? AND type = 'lok_sabha'", [lokSabhaId]);
        if (!ls) return NextResponse.json({ message: "The selected Lok Sabha no longer exists. Refresh and try again." }, { status: 400 });
        sets.push("lok_sabha_all = 0", "lok_sabha_id = ?"); vals.push(lokSabhaId);
      }
    }
    // Legacy optional fields, unchanged.
    for (const f of ["circulation", "contact_email", "contact_phone", "sort_order"]) {
      if (f in d) { sets.push(`${f} = ?`); vals.push(d[f] === "" ? null : d[f]); }
    }
    if (!sets.length) return NextResponse.json({ message: "No fields to update." }, { status: 400 });

    const exists = await query("SELECT id FROM newspapers WHERE id = ?", [id]);
    if (!exists.length) return NextResponse.json({ message: "That newspaper no longer exists." }, { status: 404 });

    vals.push(id);
    try {
      await query(`UPDATE newspapers SET ${sets.join(", ")} WHERE id = ?`, vals);
    } catch (e) {
      if (e && (e.code === "ER_DUP_ENTRY" || e.errno === 1062)) {
        return NextResponse.json({ message: "Another newspaper with this name already exists." }, { status: 409 });
      }
      throw e;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("newspaper PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// BUG 21 — Delete a newspaper. To prevent orphaned data (§7/§8), deletion is
// blocked while the newspaper still has publications (press_notes) linked to it;
// the published records are never touched. Delete only once it has none.
export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    const [cnt] = await query("SELECT COUNT(*) AS n FROM press_notes WHERE newspaper_id = ?", [id]);
    const n = Number(cnt?.n || 0);
    if (n > 0) {
      return NextResponse.json(
        { message: `This newspaper has ${n} published record${n === 1 ? "" : "s"}. Remove or reassign them from its Published List before deleting.` },
        { status: 409 }
      );
    }
    const res = await query("DELETE FROM newspapers WHERE id = ?", [id]);
    if (!res.affectedRows) return NextResponse.json({ message: "Newspaper not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("newspaper DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
