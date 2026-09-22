import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureNotInterestedColumns } from "@/lib/contactExtras";

// PUT /api/not-interested/[id]  { action: "restore" }
// EXPLICIT restore of a Not-Interested contact back to Main Contacts. Clears the
// persistent flag (and reopens the record) so it becomes visible, searchable and
// assignable again — the SAME contact row, no duplicate, no lost data. Restricted
// to oversight roles; a contact is never auto-restored (a later non-negative call
// does not clear the flag). Idempotent: restoring an already-active contact is a
// no-op success.
export const dynamic = "force-dynamic";

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (!(await ensureNotInterestedColumns())) {
      return NextResponse.json({ message: "Not Interested is not enabled on this deployment." }, { status: 400 });
    }
    const { id } = await params;
    const [row] = await query("SELECT id FROM contacts WHERE id = ?", [id]);
    if (!row) return NextResponse.json({ message: "Contact not found." }, { status: 404 });

    // Clear the flag AND reopen the record so it re-enters the active/assignable
    // pool (mirrors the Wrong Number restore). The contact's details, photo and
    // call history are untouched.
    await query(
      `UPDATE contacts
          SET is_not_interested = 0, not_interested_reason = NULL, not_interested_at = NULL, is_completed = 0
        WHERE id = ?`,
      [id]
    );
    return NextResponse.json({ ok: true, id: Number(id) });
  } catch (err) {
    console.error("not-interested restore error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
