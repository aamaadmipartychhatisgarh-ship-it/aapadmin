import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { restoreRepeatOff, repeatOffRestoreAvailable } from "@/lib/repeatOff";
import { contactListLocation, LIST_LABELS } from "@/lib/contactListLocation";
import { logAudit } from "@/lib/audit";

// PUT /api/contacts/repeat-off/[id]  { type: "switched" | "incoming" }
// EXPLICIT restore of a contact from ONE 10+ list — a true MOVE of the SAME contact
// row (nothing copied, nothing deleted, call history intact). The row leaves that
// list immediately and lands wherever its remaining state puts it (normally Main
// Contacts; a Wrong-Number / Not-Interested flag takes precedence). Idempotent: a
// repeated request for a contact no longer in the list is a no-op success with
// moved:false. Response: { ok, id, type, moved, from, destination: { key, label } }.
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "contacts", session && isSupervisor(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const type = body?.type === "incoming" ? "incoming" : "switched";
    const [row] = await query("SELECT id FROM contacts WHERE id = ?", [id]);
    if (!row) return NextResponse.json({ message: "Contact not found." }, { status: 404, headers: NO_STORE });
    if (!(await repeatOffRestoreAvailable())) {
      return NextResponse.json({ message: "Restore is not available: the restore marker columns could not be created on this database." }, { status: 500, headers: NO_STORE });
    }
    const { moved } = await restoreRepeatOff(id, type);
    const destination = await contactListLocation(id);
    if (moved) {
      logAudit(session, { action: "contact.repeat_off_restore", entityType: "contact", entityId: id, details: { type, destination: destination?.key || null } });
    }
    return NextResponse.json(
      { ok: true, id: Number(id), type, moved, from: LIST_LABELS[type], destination },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error("repeat-off restore error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
