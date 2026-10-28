import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { logAudit } from "@/lib/audit";
import { deleteUnfilteredContacts } from "@/lib/unfilteredContacts";

const NO_STORE = { "Cache-Control": "no-store" };

// POST /api/unfiltered-contacts/delete  { ids: [..] } | { all_matching: true, q? }
// Bulk Delete of Unfiltered Contact (call) records - same authorization as managing Unfiltered Contacts.
// All-or-nothing: on any failure nothing is deleted. NOT Remove Assignment (assignments/remove).
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "unfiltered_contacts", session && isAdmin(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const body = await req.json().catch(() => ({}));
    const all = body.all_matching === true;
    if (!all && (!Array.isArray(body.ids) || body.ids.some((x) => !Number.isInteger(Number(x)) || Number(x) <= 0))) {
      return NextResponse.json({ message: "Invalid selection." }, { status: 400, headers: NO_STORE });
    }
    const r = await deleteUnfilteredContacts({ ids: body.ids, allMatching: all, q: body.q, status: body.status });
    if (r.status === 200 && r.deleted > 0) {
      await logAudit(session, {
        action: "unfiltered_contacts.delete", entityType: "unfiltered_contacts", entityId: null,
        details: { deleted: r.deleted, all_matching: all, q: all ? String(body.q || "") : undefined, ids: all ? undefined : (r.deleted_ids || []).slice(0, 500) },
      }).catch(() => {});
    }
    const { status, ...rest } = r;
    return NextResponse.json(rest, { status, headers: NO_STORE });
  } catch (err) {
    console.error("unfiltered delete error:", err);
    return NextResponse.json({ message: "Could not delete the selected calls. Nothing was deleted." }, { status: 500, headers: NO_STORE });
  }
}
