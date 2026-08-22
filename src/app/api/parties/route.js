import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensurePartiesTable, normalizePartyName } from "@/lib/parties";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate, private" };

// GET /api/parties — the Party Master list (id, name, logo_url). Available to any
// signed-in user so the party dropdowns (MLA profile, etc.) can load it.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensurePartiesTable();
    const rows = await query("SELECT id, name, logo_url, created_at, updated_at FROM parties ORDER BY name ASC");
    return NextResponse.json({ parties: rows }, { headers: noStore });
  } catch (e) {
    console.error("[parties] GET:", e);
    return NextResponse.json({ message: "Failed to load the party master." }, { status: 500 });
  }
}

// POST /api/parties — add a party. Name required + UNIQUE (case-insensitive);
// logo_url optional (a /uploads/... reference from the shared image uploader).
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensurePartiesTable();
    const d = await req.json().catch(() => ({}));
    const name = normalizePartyName(d?.name);
    if (!name) return NextResponse.json({ message: "Party name is required." }, { status: 400 });
    if (name.length > 255) return NextResponse.json({ message: "Name is too long (max 255 characters)." }, { status: 400 });
    const logo_url = d?.logo_url ? String(d.logo_url).trim() : null;

    const [dup] = await query("SELECT id, name FROM parties WHERE name = ?", [name]);
    if (dup) return NextResponse.json({ message: `"${dup.name}" already exists in the party master.` }, { status: 409 });

    let res;
    try {
      res = await query("INSERT INTO parties (name, logo_url) VALUES (?, ?)", [name, logo_url]);
    } catch (e) {
      if (e && (e.code === "ER_DUP_ENTRY" || e.errno === 1062)) {
        return NextResponse.json({ message: `"${name}" already exists in the party master.` }, { status: 409 });
      }
      throw e;
    }
    const [row] = await query("SELECT id, name, logo_url, created_at, updated_at FROM parties WHERE id = ?", [res.insertId]);
    return NextResponse.json({ ok: true, party: row }, { headers: noStore });
  } catch (e) {
    console.error("[parties] POST:", e);
    return NextResponse.json({ message: "Failed to add the party." }, { status: 500 });
  }
}
