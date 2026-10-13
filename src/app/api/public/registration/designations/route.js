import { NextResponse } from "next/server";
import { readRegSession } from "@/lib/regLinkAuth";
import { resolveRegistrationSubmitter, listAssignableDesignations } from "@/lib/registrationDesignation";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// GET /api/public/registration/designations
// Tells the registration form whether the SIGNED-IN karyakarta may assign a
// designation (only a Block President or a Vidhansabha Prabhari may) and, if so,
// the choices — straight from the Designation Master. Eligibility is derived on the
// server from the OTP session; an anonymous or ineligible caller gets
// { eligible: false } and NO designation list. The submit endpoint re-checks.
export async function GET(req) {
  try {
    const s = readRegSession(req, null);
    if (!s?.rwid) return NextResponse.json({ eligible: false }, { headers: NO_STORE });
    const who = await resolveRegistrationSubmitter(s.rwid);
    if (!who.eligible) return NextResponse.json({ eligible: false }, { headers: NO_STORE });
    return NextResponse.json({ eligible: true, label: who.label, designations: await listAssignableDesignations() }, { headers: NO_STORE });
  } catch (err) {
    console.error("[registration] designations GET:", err?.message || err);
    // Never block the registration form over this optional field.
    return NextResponse.json({ eligible: false }, { headers: NO_STORE });
  }
}
