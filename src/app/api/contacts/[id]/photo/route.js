import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { resolveActingUserId } from "@/lib/actAs";
import { query } from "@/lib/db";
import { hasContactPhotoColumn, hasContactPhotoUpdatedAtColumn } from "@/lib/contactExtras";
import { deleteLocalUpload } from "@/lib/uploadCleanup";

// POST /api/contacts/[id]/photo  { photo_url }
// Saves a profile photo directly on the contact (contacts.photo_url) — no
// longer routes through a linked worker record (Worker Management was
// removed; contacts are fully standalone now).
//
// Authorization MIRRORS the contact edit (PUT /api/contacts/[id]): admin role OR a
// "contacts" Page-Access grant may set any contact's photo; otherwise a caller may
// set the photo of a contact they currently hold (locked mid-call) OR one ASSIGNED
// to them. Previously this required the lock holder only (and read session.user.id
// directly), so setting a photo from My Calls / Edit-in-Workspace failed with "Could
// not save" on a previously-called contact that was assigned to the caller but no
// longer locked — even though editing its other details was allowed. Using
// resolveActingUserId also keeps Super-Admin "view as caller" working, exactly like
// the edit route.
export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const admin = await pageAllowed(session, "contacts", session && isAdmin(session));
    if (!admin) {
      const { userId } = await resolveActingUserId(session);
      const [row] = await query("SELECT locked_by_user_id, assigned_to_user_id FROM contacts WHERE id = ?", [id]);
      const mine = row && (String(row.locked_by_user_id) === String(userId) || String(row.assigned_to_user_id) === String(userId));
      if (!mine) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
      }
    }
    if (!(await hasContactPhotoColumn())) {
      return NextResponse.json({ message: "Contact photos are not enabled on this deployment yet." }, { status: 400 });
    }
    const { photo_url } = await req.json();

    const [prev] = await query("SELECT photo_url FROM contacts WHERE id = ?", [id]);
    const oldPhoto = prev?.photo_url || null;
    // Stamp when the photo changed (feature-detected) so a later "photo
    // disappeared" report can be traced to the moment it was set/cleared.
    if (await hasContactPhotoUpdatedAtColumn()) {
      await query("UPDATE contacts SET photo_url = ?, photo_updated_at = NOW() WHERE id = ?", [photo_url || null, id]);
    } else {
      await query("UPDATE contacts SET photo_url = ? WHERE id = ?", [photo_url || null, id]);
    }

    if (oldPhoto && oldPhoto !== (photo_url || null)) await deleteLocalUpload(oldPhoto);

    return NextResponse.json({ ok: true, photo_url: photo_url || null });
  } catch (err) {
    console.error("contact photo error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
