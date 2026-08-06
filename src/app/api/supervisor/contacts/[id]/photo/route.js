import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSupervisorRole } from "@/lib/permissions";
import { query } from "@/lib/db";
import { hasContactPhotoColumn } from "@/lib/contactExtras";
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
    const { photo_url } = await req.json();
    const scope = supervisorScopeFilter(session.user, "c");

    const [prev] = await query(`SELECT photo_url FROM contacts c WHERE c.id = ? ${scope.where}`, [id, ...scope.params]);
    if (!prev) {
      return NextResponse.json({ message: "Contact not found or outside your territory." }, { status: 404 });
    }
    const oldPhoto = prev.photo_url || null;
    const res = await query(
      `UPDATE contacts c SET c.photo_url = ? WHERE c.id = ? ${scope.where}`,
      [photo_url || null, id, ...scope.params]
    );
    if (res.affectedRows === 0) {
      return NextResponse.json({ message: "Contact not found or outside your territory." }, { status: 404 });
    }
    if (oldPhoto && oldPhoto !== (photo_url || null)) await deleteLocalUpload(oldPhoto);

    return NextResponse.json({ ok: true, photo_url: photo_url || null });
  } catch (err) {
    console.error("supervisor contact photo error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
