import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { logAudit } from "@/lib/audit";
import { deleteUnfilteredContacts } from "@/lib/unfilteredContacts";

const NO_STORE = { "Cache-Control": "no-store" };

// DELETE /api/unfiltered-contacts/:id - delete ONE Unfiltered Contact (call) record. Same authorization
// and behaviour as the bulk delete; NOT Remove Assignment (./assignment).
export async function DELETE(_req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "unfiltered_contacts", session && isAdmin(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const { id } = await params;
    if (!/^\d+$/.test(String(id)) || Number(id) <= 0) return NextResponse.json({ message: "Invalid call." }, { status: 400, headers: NO_STORE });
    const r = await deleteUnfilteredContacts({ ids: [Number(id)] });
    if (r.status === 200 && r.deleted === 0) return NextResponse.json({ message: "This call no longer exists.", deleted: 0 }, { status: 404, headers: NO_STORE });
    if (r.status === 200) await logAudit(session, { action: "unfiltered_contacts.delete", entityType: "unfiltered_contact", entityId: String(id), details: { deleted: 1 } }).catch(() => {});
    const { status, ...rest } = r;
    return NextResponse.json(rest, { status, headers: NO_STORE });
  } catch (err) {
    console.error("unfiltered single delete error:", err);
    return NextResponse.json({ message: "Could not delete the call. Nothing was deleted." }, { status: 500, headers: NO_STORE });
  }
}
