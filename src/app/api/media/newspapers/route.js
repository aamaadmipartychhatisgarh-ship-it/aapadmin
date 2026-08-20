import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensurePressNotesSchema } from "@/lib/pressNotesSchema";

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensurePressNotesSchema(); // make sure the lok_sabha_* columns exist
    const d = await req.json();
    const name = String(d?.name ?? "").trim();
    if (!name) return NextResponse.json({ message: "Newspaper name is required." }, { status: 400 });

    // Lok Sabha selection is required: either "All" (a supported flag) or a
    // specific Lok Sabha from the master (locations type='lok_sabha').
    const lokSabhaAll = d?.lok_sabha_all === true || d?.lok_sabha_id === "all";
    let lokSabhaId = null;
    if (!lokSabhaAll) {
      if (d?.lok_sabha_id == null || d.lok_sabha_id === "") {
        return NextResponse.json({ message: "Please select a Lok Sabha (or choose “All”)." }, { status: 400 });
      }
      if (!/^\d+$/.test(String(d.lok_sabha_id))) {
        return NextResponse.json({ message: "Invalid Lok Sabha selection." }, { status: 400 });
      }
      lokSabhaId = Number(d.lok_sabha_id);
      const [ls] = await query("SELECT id FROM locations WHERE id = ? AND type = 'lok_sabha'", [lokSabhaId]);
      if (!ls) return NextResponse.json({ message: "The selected Lok Sabha no longer exists. Refresh and try again." }, { status: 400 });
    }

    // Prevent a duplicate for the SAME newspaper name + Lok Sabha mapping.
    const [dup] = await query(
      lokSabhaAll
        ? "SELECT id FROM newspapers WHERE name = ? AND lok_sabha_all = 1 LIMIT 1"
        : "SELECT id FROM newspapers WHERE name = ? AND lok_sabha_all = 0 AND lok_sabha_id = ? LIMIT 1",
      lokSabhaAll ? [name] : [name, lokSabhaId]
    );
    if (dup) {
      return NextResponse.json({ message: `“${name}” already exists for ${lokSabhaAll ? "All Lok Sabha" : "this Lok Sabha"}.` }, { status: 409 });
    }

    let res;
    try {
      res = await query(
        `INSERT INTO newspapers (name, circulation, contact_email, contact_phone, sort_order, lok_sabha_id, lok_sabha_all)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name, d.circulation || null, d.contact_email || null, d.contact_phone || null, Number(d.sort_order) || 0, lokSabhaId, lokSabhaAll ? 1 : 0]
      );
    } catch (e) {
      // The legacy UNIQUE(name) key would reject a second row for the same paper
      // under a different Lok Sabha — surface that clearly instead of a 500.
      if (e && (e.code === "ER_DUP_ENTRY" || e.errno === 1062)) {
        return NextResponse.json({ message: `“${name}” already exists in the newspaper master.` }, { status: 409 });
      }
      throw e;
    }
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("newspapers POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
