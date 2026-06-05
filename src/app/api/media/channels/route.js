import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const d = await req.json();
    if (!d.name) return NextResponse.json({ message: "Name required" }, { status: 400 });
    const res = await query(
      `INSERT INTO news_channels (name, contact_email, contact_phone, tone, sort_order) VALUES (?, ?, ?, ?, ?)`,
      [d.name, d.contact_email || null, d.contact_phone || null, d.tone || "unknown", Number(d.sort_order) || 0]
    );
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("channels POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
