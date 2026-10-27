import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { normalizeRole, ROLES } from "@/lib/permissions";
import { callerZoneAccess } from "@/lib/callerZoneScope";
import { selfAssignContacts } from "@/lib/contactAssign";

const NO_STORE = { "Cache-Control": "no-store" };

// POST /api/zone-contacts/self-assign { contact_ids: [..] }
// A Caller assigns eligible contacts of their OWN, CURRENT Zone to themselves. The assignee is always the
// logged-in caller (no assignee is accepted from the request) and the Zone is re-read from the database on
// every request, so a caller can never assign outside their Zone, to someone else, or after losing the Zone.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (normalizeRole(session.user.role) !== ROLES.CALLER) return NextResponse.json({ message: "Only a Caller can assign contacts to themselves." }, { status: 403, headers: NO_STORE });
    const access = await callerZoneAccess(session);
    if (!access) return NextResponse.json({ message: "You do not have access to Zone Contacts." }, { status: 403, headers: NO_STORE });
    if (!access.zoneId) return NextResponse.json({ message: "You have no Zone assigned." }, { status: 403, headers: NO_STORE });
    const body = await req.json().catch(() => ({}));
    if (!Array.isArray(body.contact_ids) || body.contact_ids.some((x) => !Number.isInteger(Number(x)) || Number(x) <= 0)) {
      return NextResponse.json({ message: "Invalid selection." }, { status: 400, headers: NO_STORE });
    }
    const r = await selfAssignContacts(session, access.zoneId, body.contact_ids);
    const { status, ...rest } = r;
    return NextResponse.json(rest, { status, headers: NO_STORE });
  } catch (err) {
    console.error("zone self-assign error:", err);
    return NextResponse.json({ message: "Could not assign the contacts. Nothing was changed." }, { status: 500, headers: NO_STORE });
  }
}
