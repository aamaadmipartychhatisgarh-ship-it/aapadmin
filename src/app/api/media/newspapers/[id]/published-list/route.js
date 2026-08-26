import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensurePressNotesSchema } from "@/lib/pressNotesSchema";

export const dynamic = "force-dynamic";

// GET /api/media/newspapers/[id]/published-list — the complete published records
// for ONE newspaper, loaded by newspaper ID (never by name). Returns the
// newspaper (with its Lok Sabha mapping + total published) and every press_note
// keyed to it, each carrying the newspaper's Lok Sabha for the Lok Sabha filter.
export async function GET(_req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensurePressNotesSchema();
    const { id } = await params;
    if (!/^\d+$/.test(String(id))) return NextResponse.json({ message: "Invalid newspaper id." }, { status: 400 });

    const [np] = await query(
      `SELECT np.id, np.name, np.lok_sabha_id, np.lok_sabha_all, ls.name AS lok_sabha_name
         FROM newspapers np
         LEFT JOIN locations ls ON ls.id = np.lok_sabha_id AND ls.type = 'lok_sabha'
        WHERE np.id = ?`,
      [id]
    );
    if (!np) return NextResponse.json({ message: "Newspaper not found." }, { status: 404 });

    const records = await query(
      `SELECT pn.id, pn.title, pn.summary, pn.kind, pn.sentiment, pn.coverage_date, pn.file_url,
              pn.newspaper_id, pn.lok_sabha_id AS pub_lok_sabha_id,
              np.name AS newspaper_name, np.lok_sabha_id, np.lok_sabha_all, ls.name AS lok_sabha_name
         FROM press_notes pn
         JOIN newspapers np ON np.id = pn.newspaper_id
         LEFT JOIN locations ls ON ls.id = np.lok_sabha_id AND ls.type = 'lok_sabha'
        WHERE pn.newspaper_id = ?
        ORDER BY pn.coverage_date DESC, pn.id DESC`,
      [id]
    );

    return NextResponse.json({
      newspaper: {
        id: np.id,
        name: np.name,
        lok_sabha_all: !!Number(np.lok_sabha_all),
        lok_sabha_name: np.lok_sabha_name || null,
        total_published: records.length,
      },
      records,
    });
  } catch (err) {
    console.error("published-list GET error:", err);
    return NextResponse.json({ message: "Failed to load the published list." }, { status: 500 });
  }
}
