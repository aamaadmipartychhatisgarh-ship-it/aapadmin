import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const d = await req.json();
    if (!d.title) return NextResponse.json({ message: "Title required" }, { status: 400 });
    const res = await query(
      `INSERT INTO press_notes (title, summary, file_url, kind, newspaper_id, coverage_date, sentiment, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.title, d.summary || null, d.file_url || null, d.kind || "press_note",
       d.newspaper_id || null, d.coverage_date || null, d.sentiment || null, session.user.id]
    );
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("press-notes POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
