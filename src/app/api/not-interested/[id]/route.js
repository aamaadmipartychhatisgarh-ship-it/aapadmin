import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureNotInterestedColumns, restoreNotInterested } from "@/lib/contactExtras";
import { contactListLocation, LIST_LABELS } from "@/lib/contactListLocation";
import { logAudit } from "@/lib/audit";

// PUT /api/not-interested/[id]  { action: "restore" }
// EXPLICIT restore of a Not-Interested contact — a true MOVE of the SAME contact row
// (no copy, no duplicate, no lost data). Clears the persistent flag and stamps the
// restore watermark so every derived reason stops matching too; the row leaves the
// list on the next read and lands wherever its remaining state puts it (normally
// Main Contacts; a Wrong-Number flag or a 10+ list takes precedence). Restricted to
// oversight roles; a contact is never auto-restored. Idempotent: repeating the
// request for a contact that is no longer in the list is a no-op success
// (moved:false). Response: { ok, id, moved, from, destination: { key, label } }.
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    if (!(await ensureNotInterestedColumns())) {
      return NextResponse.json({ message: "Not Interested is not enabled on this deployment." }, { status: 400, headers: NO_STORE });
    }
    const { id } = await params;
    const [row] = await query("SELECT id FROM contacts WHERE id = ?", [id]);
    if (!row) return NextResponse.json({ message: "Contact not found." }, { status: 404, headers: NO_STORE });

    const { moved } = await restoreNotInterested(id);
    const destination = await contactListLocation(id);
    if (moved) {
      logAudit(session, { action: "contact.not_interested_restore", entityType: "contact", entityId: id, details: { destination: destination?.key || null } });
    }
    return NextResponse.json(
      { ok: true, id: Number(id), moved, from: LIST_LABELS.not_interested, destination },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error("not-interested restore error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
