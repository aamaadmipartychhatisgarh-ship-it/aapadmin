import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";

// GET invites + their attendance for a conference
export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const invites = await query(
      `SELECT ji.*, j.name AS journalist_name, j.outlet, j.mobile
         FROM journalist_invites ji JOIN journalists j ON j.id = ji.journalist_id
        WHERE ji.conference_id = ?`, [id]
    );
    return NextResponse.json({ invites });
  } catch (err) {
    console.error("invites GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// POST: invite a journalist OR mark whatsapp_sent / call_reminder_sent / attended
// Body: { journalist_id, whatsapp_sent?, call_reminder_sent?, attended? }
export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const d = await req.json();
    if (!d.journalist_id) return NextResponse.json({ message: "journalist_id required" }, { status: 400 });

    // Insert or update on the unique (conference, journalist) pair.
    await query(
      `INSERT INTO journalist_invites (conference_id, journalist_id, whatsapp_sent, call_reminder_sent, attended)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         whatsapp_sent = VALUES(whatsapp_sent),
         call_reminder_sent = VALUES(call_reminder_sent),
         attended = VALUES(attended)`,
      [id, d.journalist_id, d.whatsapp_sent ? 1 : 0, d.call_reminder_sent ? 1 : 0, d.attended ? 1 : 0]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("invite POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
