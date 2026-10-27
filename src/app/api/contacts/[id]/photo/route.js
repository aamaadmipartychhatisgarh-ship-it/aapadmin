import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, isOversight } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { resolveActingUserId } from "@/lib/actAs";
import { query } from "@/lib/db";
import { hasContactPhotoColumn, hasContactPhotoUpdatedAtColumn } from "@/lib/contactExtras";
import { deleteLocalUpload } from "@/lib/uploadCleanup";
import { ensurePhotoVerifiedColumn } from "@/lib/contactPhotoRecovery";
import { callerOwnsContact } from "@/lib/callerContactAccess";
import { validateContactPhotoUrl } from "@/lib/contactPhotoUrl";
import { logAudit } from "@/lib/audit";

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
    // Admins + Supervisors (oversight) OR a "contacts" grant may manage any
    // contact's photo, INCLUDING removing it. isOversight covers the Supervisor
    // role explicitly (the Photo spec: a Caller may upload/replace but only a
    // Supervisor may remove).
    const canManage = await pageAllowed(session, "contacts", session && isOversight(session));
    if (!canManage) {
      // EXACTLY the rule the contact edit uses (held, assigned, or already called).
      // This route used to accept only held/assigned, so on a contact the caller had
      // called before (opened via My Calls → Edit in Workspace after the lock
      // expired) the details saved but the photo was refused — it never persisted.
      const { userId } = await resolveActingUserId(session);
      const mine = await callerOwnsContact(id, userId);
      if (!mine) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
      }
    }
    if (!(await hasContactPhotoColumn())) {
      return NextResponse.json({ message: "Contact photos are not enabled on this deployment yet." }, { status: 400 });
    }
    const { photo_url } = await req.json().catch(() => ({}));

    // PHOTO PERSISTENCE RULE (spec): a Caller may upload/replace a photo but must
    // NOT be able to remove it — only a Supervisor/Admin may delete it, and it
    // stays available until they do. An empty photo_url from a non-managing editor
    // (a caller) is a removal attempt: reject it server-side so the restriction
    // can't be bypassed by calling this API directly. A caller replacing the photo
    // (a new, non-empty photo_url) is still allowed.
    const removing = !photo_url || !String(photo_url).trim();
    if (removing && !canManage) {
      return NextResponse.json(
        { message: "Only a supervisor can remove a photo. You can upload a new photo to replace it." },
        { status: 403 }
      );
    }
    // A new photo must be one this app stored (never an arbitrary string / external URL /
    // file that does not exist — that would leave a dangling reference).
    const checked = await validateContactPhotoUrl(photo_url);
    if (checked.error) return NextResponse.json({ message: checked.error }, { status: checked.transient ? 503 : 400 });

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

    // Record verified availability: a fresh upload's bytes are in the durable store
    // now (1); a remove clears it (0). Keeps the Photo Data count accurate without a
    // re-scan. Best-effort — the column is created lazily by recovery.
    await ensurePhotoVerifiedColumn();
    await query("UPDATE contacts SET photo_verified = ? WHERE id = ?", [photo_url ? 1 : 0, id]).catch(() => {});

    logAudit(session, { action: removing ? "contact.photo_remove" : "contact.photo_set", entityType: "contact", entityId: String(id), details: { photo_url: photo_url || null, previous: oldPhoto } });
    return NextResponse.json({ ok: true, photo_url: photo_url || null });
  } catch (err) {
    console.error("contact photo error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
