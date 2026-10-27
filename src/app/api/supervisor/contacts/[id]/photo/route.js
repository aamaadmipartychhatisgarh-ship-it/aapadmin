import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSupervisorRole } from "@/lib/permissions";
import { query } from "@/lib/db";
import { hasContactPhotoColumn, hasContactPhotoUpdatedAtColumn } from "@/lib/contactExtras";
import { validateContactPhotoUrl } from "@/lib/contactPhotoUrl";
import { ensurePhotoVerifiedColumn } from "@/lib/contactPhotoRecovery";
import { logAudit } from "@/lib/audit";
import { deleteLocalUpload } from "@/lib/uploadCleanup";
import { supervisorScopeFilter } from "@/lib/supervisorScope";

// POST /api/supervisor/contacts/[id]/photo  { photo_url }
// Territory-scoped mirror of POST /api/contacts/[id]/photo. The supervisor's
// scope clause is baked into the UPDATE's WHERE, so a contact outside their
// territory is atomically unreachable (not merely hidden), matching every other
// /api/supervisor/contacts/* route. Passing photo_url = null removes the photo.
export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisorRole(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasContactPhotoColumn())) {
      return NextResponse.json({ message: "Contact photos are not enabled on this deployment yet." }, { status: 400 });
    }
    const { id } = await params;
    const { photo_url } = await req.json().catch(() => ({}));
    const checked = await validateContactPhotoUrl(photo_url);
    if (checked.error) return NextResponse.json({ message: checked.error }, { status: checked.transient ? 503 : 400 });
    const scope = supervisorScopeFilter(session.user, "c");

    const [prev] = await query(`SELECT photo_url FROM contacts c WHERE c.id = ? ${scope.where}`, [id, ...scope.params]);
    if (!prev) {
      return NextResponse.json({ message: "Contact not found or outside your territory." }, { status: 404 });
    }
    const oldPhoto = prev.photo_url || null;
    // Same stamps as the admin route: when the photo changed (so a "photo disappeared" report can be
    // traced) and whether its bytes are verified present.
    const stamp = (await hasContactPhotoUpdatedAtColumn()) ? ", c.photo_updated_at = NOW()" : "";
    const res = await query(
      `UPDATE contacts c SET c.photo_url = ?${stamp} WHERE c.id = ? ${scope.where}`,
      [photo_url || null, id, ...scope.params]
    );
    if (res.affectedRows === 0) {
      return NextResponse.json({ message: "Contact not found or outside your territory." }, { status: 404 });
    }
    if (oldPhoto && oldPhoto !== (photo_url || null)) await deleteLocalUpload(oldPhoto);
    await ensurePhotoVerifiedColumn();
    await query("UPDATE contacts SET photo_verified = ? WHERE id = ?", [photo_url ? 1 : 0, id]).catch(() => {});
    logAudit(session, { action: photo_url ? "contact.photo_set" : "contact.photo_remove", entityType: "contact", entityId: String(id), details: { supervisor: true, photo_url: photo_url || null, previous: oldPhoto } });

    return NextResponse.json({ ok: true, photo_url: photo_url || null });
  } catch (err) {
    console.error("supervisor contact photo error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
