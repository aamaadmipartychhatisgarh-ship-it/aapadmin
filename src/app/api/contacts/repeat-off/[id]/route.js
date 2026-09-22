import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { restoreRepeatOff } from "@/lib/repeatOff";

// PUT /api/contacts/repeat-off/[id]  { type: "switched" | "incoming" }
// EXPLICIT restore of a contact from ONE 10+ list back to Main Contacts. Stamps the
// per-type restore time so the contact leaves that list and becomes active and
// assignable again — the SAME contact record, with its ENTIRE call history intact
// (nothing is deleted). A later off-call of that type re-triggers the automatic rule
// (§8, §9, §10). Restricted to the same "contacts" access the page uses.
export const dynamic = "force-dynamic";

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "contacts", session && isSupervisor(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const type = body?.type === "incoming" ? "incoming" : "switched";
    const [row] = await query("SELECT id FROM contacts WHERE id = ?", [id]);
    if (!row) return NextResponse.json({ message: "Contact not found." }, { status: 404 });
    await restoreRepeatOff(id, type);
    return NextResponse.json({ ok: true, id: Number(id), type });
  } catch (err) {
    console.error("repeat-off restore error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
