import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { logAudit } from "@/lib/audit";
import { convertActiveUnfilteredToContacts } from "@/lib/unfilteredContacts";

const NO_STORE = { "Cache-Control": "no-store" };

// POST /api/unfiltered-contacts/convert { ids: [..] | all_matching: true, q?, status?, dry_run? }
// Bulk-convert the selected Unfiltered records whose saved status is Active into Contacts (existing conversion; never a
// duplicate, the Contact keeps its own source). dry_run only classifies the selection for the confirmation dialog.
// Same authorization as managing Unfiltered Contacts (Super Admin / Admin, or a user granted that page).
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
    const dry = body.dry_run === true;
    const r = await convertActiveUnfilteredToContacts({ ids: body.ids, allMatching: all, q: body.q, status: body.status, userId: Number(session.user.id) || null, dryRun: dry });
    if (r.status === 200 && !dry && r.converted > 0) {
      await logAudit(session, {
        action: "unfiltered_contacts.convert", entityType: "unfiltered_contacts", entityId: null,
        details: { converted: r.converted, created: r.created, linked_existing: r.linked_existing, ids: (r.converted_ids || []).slice(0, 500) },
      }).catch(() => {});
    }
    const { status, ...rest } = r;
    return NextResponse.json(rest, { status, headers: NO_STORE });
  } catch (err) {
    console.error("unfiltered convert error:", err);
    return NextResponse.json({ message: "Could not convert the selected records." }, { status: 500, headers: NO_STORE });
  }
}
