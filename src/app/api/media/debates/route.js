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
    if (!d.topic || !d.debate_date) return NextResponse.json({ message: "Topic and date required" }, { status: 400 });
    const res = await query(
      `INSERT INTO debates (channel_id, topic, debate_date, debate_time, brief_pdf_url, talking_points, opposition_counter, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.channel_id || null, d.topic, d.debate_date, d.debate_time || null,
       d.brief_pdf_url || null, d.talking_points || null, d.opposition_counter || null,
       d.status || "scheduled"]
    );
    // Optional: assign spokespersons in same request
    if (Array.isArray(d.spokesperson_ids)) {
      for (const sid of d.spokesperson_ids) {
        await query(`INSERT IGNORE INTO debate_assignments (debate_id, spokesperson_id) VALUES (?, ?)`, [res.insertId, sid]);
      }
    }
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("debates POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
