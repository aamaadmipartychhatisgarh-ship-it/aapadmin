import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensurePressNotesSchema, resolveNewspaperId } from "@/lib/pressNotesSchema";

const strOrNull = (v) => { const s = String(v ?? "").trim(); return s ? s : null; };

// POST /api/media/press-notes — create a press-note / coverage record.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensurePressNotesSchema();
    const d = await req.json().catch(() => ({}));
    const title = strOrNull(d.title);
    if (!title) return NextResponse.json({ message: "Title is required." }, { status: 400 });

    // Newspaper: use the selected id, or resolve a typed "Other" name to one.
    let newspaperId = d.newspaper_id ? Number(d.newspaper_id) : null;
    if (!newspaperId && d.newspaper_name) newspaperId = await resolveNewspaperId(d.newspaper_name);

    const res = await query(
      `INSERT INTO press_notes (title, summary, file_url, kind, newspaper_id, coverage_date, sentiment, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, strOrNull(d.summary), strOrNull(d.file_url), strOrNull(d.kind) || "press_note",
       newspaperId, strOrNull(d.coverage_date), strOrNull(d.sentiment), session.user.id]
    );
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("press-notes POST error:", err);
    return NextResponse.json({ message: "Could not save the press coverage. Please try again." }, { status: 500 });
  }
}
