import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";
import { hasContactPhotoColumn } from "@/lib/contactExtras";
import { deleteLocalUpload } from "@/lib/uploadCleanup";

// POST /api/contacts/[id]/photo  { photo_url }
// Saves a profile photo directly on the contact (contacts.photo_url) — no
// longer routes through a linked worker record (Worker Management was
// removed; contacts are fully standalone now).
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
    if (!(await hasContactPhotoColumn())) {
      return NextResponse.json({ message: "Contact photos are not enabled on this deployment yet." }, { status: 400 });
    }
    const { photo_url } = await req.json();

    const [prev] = await query("SELECT photo_url FROM contacts WHERE id = ?", [id]);
    const oldPhoto = prev?.photo_url || null;
    await query("UPDATE contacts SET photo_url = ? WHERE id = ?", [photo_url || null, id]);

    if (oldPhoto && oldPhoto !== (photo_url || null)) await deleteLocalUpload(oldPhoto);

    return NextResponse.json({ ok: true, photo_url: photo_url || null });
  } catch (err) {
    console.error("contact photo error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
