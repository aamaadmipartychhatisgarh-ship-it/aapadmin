import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { normalizeRole, ROLES } from "@/lib/permissions";
import { callerZoneAccess } from "@/lib/callerZoneScope";
import { removeOwnAssignments } from "@/lib/contactAssign";

const NO_STORE = { "Cache-Control": "no-store" };

// POST /api/zone-contacts/remove-assignment { contact_ids: [..] }
// A Caller removes contacts from THEIR OWN assignment. The caller is always the logged-in user (never taken from the request) and only a
// contact currently assigned to that caller can be removed - re-checked under a row lock for every contact (lib/contactAssign).
// The response lists exactly which contacts were removed and which were skipped / failed, and why.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (normalizeRole(session.user.role) !== ROLES.CALLER) return NextResponse.json({ message: "Only a Caller can remove their own assignments here." }, { status: 403, headers: NO_STORE });
    if (!(await callerZoneAccess(session))) return NextResponse.json({ message: "You do not have access to Zone Contacts." }, { status: 403, headers: NO_STORE });
    const body = await req.json().catch(() => ({}));
    if (!Array.isArray(body.contact_ids) || body.contact_ids.some((x) => !Number.isInteger(Number(x)) || Number(x) <= 0)) {
      return NextResponse.json({ message: "Invalid selection." }, { status: 400, headers: NO_STORE });
    }
    const { status, ...rest } = await removeOwnAssignments(session, body.contact_ids);
    return NextResponse.json(rest, { status, headers: NO_STORE });
  } catch (err) {
    console.error("zone remove-assignment error:", err);
    return NextResponse.json({ message: "Could not remove the assignments. Nothing was changed." }, { status: 500, headers: NO_STORE });
  }
}
