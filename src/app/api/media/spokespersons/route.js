import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const rows = await query(`SELECT * FROM spokespersons WHERE is_active = 1 ORDER BY name`);
    return NextResponse.json({ spokespersons: rows });
  } catch (err) {
    console.error("spokespersons GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const d = await req.json();
    if (!d.name) return NextResponse.json({ message: "Name required" }, { status: 400 });
    // photo_url (BUG 26) — a durable /api/uploads reference (media_files LONGBLOB),
    // so the spokesperson photo survives redeploys and is shown everywhere.
    const res = await query(
      `INSERT INTO spokespersons (name, mobile, expertise, languages, photo_url) VALUES (?, ?, ?, ?, ?)`,
      [d.name, d.mobile || null, d.expertise || null, d.languages || null, d.photo_url || null]
    );
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("spokespersons POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
