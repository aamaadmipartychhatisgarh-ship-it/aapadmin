import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { query, getPool } from "@/lib/db";
import { syncContactToWorker } from "@/lib/workerSync";
import { deleteLocalUpload } from "@/lib/uploadCleanup";

// POST /api/contacts/[id]/photo  { photo_url }
// Saves a profile photo for the person by storing the URL on their linked worker
// record (a person's photo lives on workers.photo_url, which every module reads).
// Allowed for the caller currently holding the contact, or any oversight user.
export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const admin = isOversight(session);
    if (!admin) {
      const [row] = await query("SELECT locked_by_user_id FROM contacts WHERE id = ?", [id]);
      if (!row || String(row.locked_by_user_id) !== String(session.user.id)) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
      }
    }
    const { photo_url } = await req.json();

    const pool = getPool();
    const conn = await pool.getConnection();
    let oldPhoto = null;
    try {
      await conn.beginTransaction();
      // Ensure a linked worker exists (creates + links one if not), then set its photo.
      const workerId = await syncContactToWorker(conn, id);
      if (workerId) {
        const [[prev]] = await conn.query("SELECT photo_url FROM workers WHERE id = ?", [workerId]);
        oldPhoto = prev?.photo_url || null;
        await conn.query("UPDATE workers SET photo_url = ? WHERE id = ?", [photo_url || null, workerId]);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    // Remove the previous file once the new photo is committed (or on removal).
    if (oldPhoto && oldPhoto !== (photo_url || null)) await deleteLocalUpload(oldPhoto);

    return NextResponse.json({ ok: true, photo_url: photo_url || null });
  } catch (err) {
    console.error("contact photo error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
