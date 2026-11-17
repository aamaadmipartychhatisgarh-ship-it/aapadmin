import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { buildResponsibleMessage } from "@/lib/vacancyResponsibleMessage";

// GET /api/vacancies/responsible-message?contact_id=<responsible person's Contact id>
// ONE consolidated Hindi WhatsApp message listing every post that is vacant right now and assigned to this responsible
// person (Tree Map "Assigned By", by Contact id), across all Wings and levels — built live on every call (never cached),
// within the same page gate and territory scope as the Designation Vacancies page. Read-only: it records and sends
// nothing; the user reviews, edits and sends the pre-filled message in WhatsApp.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (!(await pageAllowed(session, "vacancies", session && isAdmin(session)))) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    }
    const contactId = parseInt(new URL(req.url).searchParams.get("contact_id"), 10);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return NextResponse.json({ message: "A valid responsible person is required." }, { status: 400, headers: NO_STORE });
    }
    const out = await buildResponsibleMessage(session, contactId);
    if (out.error) return NextResponse.json({ message: out.error }, { status: out.status || 400, headers: NO_STORE });
    return NextResponse.json(out, { headers: NO_STORE });
  } catch (err) {
    console.error("[vacancies/responsible-message] GET error:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
