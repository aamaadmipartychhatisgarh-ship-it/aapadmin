import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const d = await req.json();
    if (!d.title || !d.conference_date) return NextResponse.json({ message: "Title and date required" }, { status: 400 });
    const res = await query(
      `INSERT INTO press_conferences (title, conference_date, venue, agenda, status) VALUES (?, ?, ?, ?, ?)`,
      [d.title, d.conference_date, d.venue || null, d.agenda || null, d.status || "scheduled"]
    );
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("conferences POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
