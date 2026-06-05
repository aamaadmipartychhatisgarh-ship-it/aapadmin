import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const rows = await query(`SELECT * FROM journalists ORDER BY name`);
    return NextResponse.json({ journalists: rows });
  } catch (err) {
    console.error("journalists GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const d = await req.json();
    if (!d.name) return NextResponse.json({ message: "Name required" }, { status: 400 });
    const res = await query(
      `INSERT INTO journalists (name, outlet, mobile, email) VALUES (?, ?, ?, ?)`,
      [d.name, d.outlet || null, d.mobile || null, d.email || null]
    );
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("journalists POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
