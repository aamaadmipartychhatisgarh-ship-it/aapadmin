import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

// All authenticated users can view training. Progress is per-user.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const modules = await query(
      `SELECT m.*, tp.progress_pct, tp.completed_at
         FROM training_modules m
         LEFT JOIN training_progress tp ON tp.module_id = m.id AND tp.user_id = ?
        ORDER BY m.category, m.sort_order`,
      [session.user.id]
    );
    return NextResponse.json({ modules });
  } catch (err) {
    console.error("training GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// Update progress for the logged-in user. Body: { module_id, progress_pct }
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { module_id, progress_pct } = await req.json();
    if (!module_id) return NextResponse.json({ message: "module_id required" }, { status: 400 });
    const pct = Math.max(0, Math.min(100, Number(progress_pct) || 0));
    const completed = pct >= 100 ? new Date() : null;
    await query(
      `INSERT INTO training_progress (user_id, module_id, progress_pct, completed_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE progress_pct = VALUES(progress_pct), completed_at = VALUES(completed_at)`,
      [session.user.id, module_id, pct, completed]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("training POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
