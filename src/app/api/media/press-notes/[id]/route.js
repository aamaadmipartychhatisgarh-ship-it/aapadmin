import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensurePressNotesSchema, resolveNewspaperId } from "@/lib/pressNotesSchema";

// PUT /api/media/press-notes/[id] — update one record by its unique id.
export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensurePressNotesSchema();
    const { id } = await params;
    const d = await req.json().catch(() => ({}));

    // A typed "Other" newspaper name resolves to a real newspaper id.
    if ((d.newspaper_id === "" || d.newspaper_id == null) && d.newspaper_name) {
      d.newspaper_id = await resolveNewspaperId(d.newspaper_name);
    }

    // Only the fields actually present are updated, so unchanged values are
    // preserved (e.g. an existing file_url the form left untouched).
    const fields = ["title", "summary", "file_url", "kind", "newspaper_id", "lok_sabha_id", "coverage_date", "sentiment"];
    const sets = [], vals = [];
    for (const f of fields) if (f in d) { sets.push(`${f} = ?`); vals.push(d[f] === "" ? null : d[f]); }
    if (!sets.length) return NextResponse.json({ message: "No changes to save." }, { status: 400 });

    // Existence check by unique id (an unchanged UPDATE reports 0 affected rows,
    // so we can't infer "not found" from that alone).
    const exists = await query("SELECT id FROM press_notes WHERE id = ?", [id]);
    if (!exists.length) return NextResponse.json({ message: "That record no longer exists." }, { status: 404 });

    vals.push(id);
    await query(`UPDATE press_notes SET ${sets.join(", ")} WHERE id = ?`, vals);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("press-note PUT error:", err);
    return NextResponse.json({ message: "Newspaper record could not be updated. Please try again." }, { status: 500 });
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
    return NextResponse.json({ message: "Could not delete the record. Please try again." }, { status: 500 });
  }
}
