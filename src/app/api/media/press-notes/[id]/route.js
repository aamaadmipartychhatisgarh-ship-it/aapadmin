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
    const fields = ["title", "summary", "file_url", "kind", "newspaper_id", "coverage_date", "sentiment"];
    const sets = [], vals = [];
    for (const f of fields) if (f in d) { sets.push(`${f} = ?`); vals.push(d[f] === "" ? null : d[f]); }
    if (!sets.length) return NextResponse.json({ message: "No fields" }, { status: 400 });
    vals.push(id);
    await query(`UPDATE press_notes SET ${sets.join(", ")} WHERE id = ?`, vals);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("press-note PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    await query("DELETE FROM press_notes WHERE id = ?", [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("press-note DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
