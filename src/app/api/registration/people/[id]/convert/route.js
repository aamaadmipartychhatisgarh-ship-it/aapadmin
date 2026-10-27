import { NextResponse } from "next/server";
import { requireRegistrationAccess, NO_STORE } from "@/lib/registrationGuard";
import { pageAllowed } from "@/lib/pageAccess";
import { isAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { convertRegistrationToContact } from "@/lib/registrationConvert";

export const dynamic = "force-dynamic";

// POST — "Convert to Contact" for an eligible Worker registration (rated 6/10+,
// counted, not yet converted). Needs BOTH the Registration module and the right
// to create Contacts (same rule as the Contacts module's own add). Eligibility,
// mandatory fields, duplicates and "already converted" are all re-checked here,
// inside one locked transaction (lib/registrationConvert).
export async function POST(req, { params }) {
  try {
    const { session, error } = await requireRegistrationAccess();
    if (error) return error;
    if (!(await pageAllowed(session, "contacts", isAdmin(session)))) {
      return NextResponse.json({ message: "You do not have permission to create Contacts." }, { status: 403, headers: NO_STORE });
    }
    const { id } = await params;
    const r = await convertRegistrationToContact({ registrationId: id, userId: session.user.id });
    if (r.status === 201 || r.status === 200) {
      await logAudit(session, {
        action: "registration.convert_to_contact", entityType: "reg_people", entityId: Number(id),
        details: { contact_id: r.contact_id },
      }).catch(() => {});
    }
    const { status, ...body } = r;
    return NextResponse.json(body, { status, headers: NO_STORE });
  } catch (err) {
    console.error("registration convert error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
