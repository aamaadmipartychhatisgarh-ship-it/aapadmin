import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { buildHindiReminder } from "@/lib/vacancyReminderHi";

// GET /api/vacancies/reminder-hi?contact_id=&lok_sabha_id=  (lok_sabha_id=state for State posts)
// The pre-filled Hindi WhatsApp reminder (wa.me link) for one responsible person about the vacant posts they must
// fill in that Lok Sabha. Same gate and territory scope as the Designation Vacancies page; read-only — it records
// nothing and sends nothing (the user reviews and sends the message in WhatsApp).
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (!(await pageAllowed(session, "vacancies", session && isAdmin(session)))) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    }
    const { searchParams } = new URL(req.url);
    const contactId = parseInt(searchParams.get("contact_id"), 10);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return NextResponse.json({ message: "A valid responsible person is required." }, { status: 400, headers: NO_STORE });
    }
    const out = await buildHindiReminder(session, contactId, searchParams.get("lok_sabha_id") || "state");
    if (out.error) return NextResponse.json({ message: out.error }, { status: out.status || 400, headers: NO_STORE });
    return NextResponse.json(out, { headers: NO_STORE });
  } catch (err) {
    console.error("[vacancies/reminder-hi] GET error:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
