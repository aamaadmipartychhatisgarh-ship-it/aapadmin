import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { logAudit } from "@/lib/audit";
import { bulkRemoveUnfilteredAssignments } from "@/lib/unfilteredContacts";

const NO_STORE = { "Cache-Control": "no-store" };

// POST /api/unfiltered-contacts/assignments/remove   { ids: [..] } | { all_matching: true, q? }
// Bulk Remove Assignment - clears only the Caller mapping of the chosen Unfiltered Contacts; nothing is
// deleted. Same authorization as the other Unfiltered Contact assignment actions.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "unfiltered_contacts", session && isAdmin(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const body = await req.json().catch(() => ({}));
    const r = await bulkRemoveUnfilteredAssignments({ ids: body.ids, allMatching: body.all_matching === true, q: body.q });
    if (r.status === 200 && r.removed > 0) {
      await logAudit(session, {
        action: "unfiltered_contacts.bulk_unassign", entityType: "unfiltered_contacts", entityId: null,
        details: { removed: r.removed, all_matching: body.all_matching === true, ids: body.all_matching === true ? undefined : (body.ids || []).slice(0, 200) },
      }).catch(() => {});
    }
    const { status, ...rest } = r;
    return NextResponse.json(rest, { status, headers: NO_STORE });
  } catch (err) {
    console.error("unfiltered bulk unassign error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
