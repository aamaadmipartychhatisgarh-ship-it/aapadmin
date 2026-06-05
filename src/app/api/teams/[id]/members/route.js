import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const { worker_id, role_in_team } = await req.json();
    if (!worker_id) return NextResponse.json({ message: "worker_id required" }, { status: 400 });
    await query(
      `INSERT IGNORE INTO team_members (team_id, worker_id, role_in_team) VALUES (?, ?, ?)`,
      [id, worker_id, role_in_team || null]
    );
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("team member POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const workerId = searchParams.get("worker_id");
    if (!workerId) return NextResponse.json({ message: "worker_id required" }, { status: 400 });
    await query(`DELETE FROM team_members WHERE team_id = ? AND worker_id = ?`, [id, workerId]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("team member DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
