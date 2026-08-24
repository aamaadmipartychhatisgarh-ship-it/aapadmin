import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { userCanAccessPageKey } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { ensurePartiesTable, normalizePartyName } from "@/lib/parties";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate, private" };

// PUT /api/parties/[id] — edit a party's name and/or logo. Renaming is
// duplicate-checked (case-insensitive) against every OTHER party. Only the
// fields present in the body are changed, so editing the logo never clears the
// name and vice-versa. Because a party's logo is resolved live by name wherever
// the party is used, updating the logo here reflects everywhere immediately.
export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    // Oversight, OR a user granted the Party Master page (PROMPT 10 Part A).
    if (!session || (!isOversight(session) && !(await userCanAccessPageKey(session, "party_master")))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    await ensurePartiesTable();
    const { id } = await params;
    if (!/^\d+$/.test(String(id))) return NextResponse.json({ message: "Invalid party id." }, { status: 400 });
    const [existing] = await query("SELECT id FROM parties WHERE id = ?", [id]);
    if (!existing) return NextResponse.json({ message: "Party not found." }, { status: 404 });

    const d = await req.json().catch(() => ({}));
    const sets = [];
    const args = [];
    if (d?.name !== undefined) {
      const name = normalizePartyName(d.name);
      if (!name) return NextResponse.json({ message: "Party name is required." }, { status: 400 });
      if (name.length > 255) return NextResponse.json({ message: "Name is too long (max 255 characters)." }, { status: 400 });
      const [dup] = await query("SELECT id FROM parties WHERE name = ? AND id <> ?", [name, id]);
      if (dup) return NextResponse.json({ message: `"${name}" already exists in the party master.` }, { status: 409 });
      sets.push("name = ?"); args.push(name);
    }
    if (d?.logo_url !== undefined) {
      sets.push("logo_url = ?"); args.push(d.logo_url ? String(d.logo_url).trim() : null);
    }
    if (!sets.length) return NextResponse.json({ message: "Nothing to update." }, { status: 400 });

    try {
      await query(`UPDATE parties SET ${sets.join(", ")} WHERE id = ?`, [...args, id]);
    } catch (e) {
      if (e && (e.code === "ER_DUP_ENTRY" || e.errno === 1062)) {
        return NextResponse.json({ message: "That name already exists in the party master." }, { status: 409 });
      }
      throw e;
    }
    const [row] = await query("SELECT id, name, logo_url, created_at, updated_at FROM parties WHERE id = ?", [id]);
    return NextResponse.json({ ok: true, party: row }, { headers: noStore });
  } catch (e) {
    console.error("[parties] PUT:", e);
    return NextResponse.json({ message: "Failed to update the party." }, { status: 500 });
  }
}

// DELETE /api/parties/[id] — remove a party from the master. Existing MLA /
// competitor records keep their stored party NAME (they are free-text values, not
// a FK), so deleting a party here never corrupts or blanks those records — they
// simply stop showing the (now-removed) logo.
export async function DELETE(_req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensurePartiesTable();
    const { id } = await params;
    if (!/^\d+$/.test(String(id))) return NextResponse.json({ message: "Invalid party id." }, { status: 400 });
    const res = await query("DELETE FROM parties WHERE id = ?", [id]);
    if (!res.affectedRows) return NextResponse.json({ message: "Party not found." }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    console.error("[parties] DELETE:", e);
    return NextResponse.json({ message: "Failed to delete the party." }, { status: 500 });
  }
}
