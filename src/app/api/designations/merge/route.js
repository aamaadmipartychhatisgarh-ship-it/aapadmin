import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { getPool } from "@/lib/db";

// Merge one designation into another: everything pointing at `from_id` is
// repointed to `into_id`, then `from_id` is deleted. Use this to collapse
// duplicate or synonymous designations (e.g. "Block President" and
// "block  president") into a single canonical row.
//
// Body: { from_id: number, into_id: number }
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const fromId = Number(body.from_id);
    const intoId = Number(body.into_id);
    if (!fromId || !intoId) {
      return NextResponse.json({ message: "Both from_id and into_id are required." }, { status: 400 });
    }
    if (fromId === intoId) {
      return NextResponse.json({ message: "Cannot merge a designation into itself." }, { status: 400 });
    }

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.execute(
        "SELECT id, name FROM designations WHERE id IN (?, ?)",
        [fromId, intoId]
      );
      const from = rows.find((r) => r.id === fromId);
      const into = rows.find((r) => r.id === intoId);
      if (!from || !into) {
        await conn.rollback();
        return NextResponse.json({ message: "One or both designations no longer exist." }, { status: 404 });
      }

      // Repoint every reference, then remove the now-empty duplicate.
      const [c] = await conn.execute(
        "UPDATE contacts SET designation_id = ? WHERE designation_id = ?",
        [intoId, fromId]
      );
      const [cl] = await conn.execute(
        "UPDATE calls SET designation_id = ? WHERE designation_id = ?",
        [intoId, fromId]
      );
      await conn.execute("DELETE FROM designations WHERE id = ?", [fromId]);

      await conn.commit();
      return NextResponse.json({
        ok: true,
        merged_from: from.name,
        merged_into: into.name,
        moved_contacts: c.affectedRows || 0,
        moved_calls: cl.affectedRows || 0,
      });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error("designation merge error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
