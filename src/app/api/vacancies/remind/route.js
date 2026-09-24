import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { pendingVacanciesForResponsible, groupKeyFor } from "@/lib/vacancyDashboard";
import { recordReminder, buildReminderMessage, toWhatsAppNumber, reminderHistory } from "@/lib/vacancyReminders";

// POST /api/vacancies/remind  { contact_id }
// Sends ONE grouped WhatsApp reminder to a responsible person covering ALL of
// their currently-pending vacant designations. Delivery uses WhatsApp click-to-chat
// (wa.me) — no WhatsApp Business API is configured on this deployment — so the
// server records the attempt (status + attempts + timestamp + audit log) and
// returns a wa.me URL the client opens. If the person has no usable mobile the
// attempt is recorded as FAILED (never silently "sent").
//
// GET /api/vacancies/remind?contact_id= → reminder history (audit) for that person.
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

async function guard() {
  const session = await getServerSession(authOptions);
  if (!session) return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE }) };
  if (!(await pageAllowed(session, "vacancies", session && isAdmin(session)))) {
    return { error: NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE }) };
  }
  return { session };
}

export async function POST(req) {
  try {
    const { session, error } = await guard();
    if (error) return error;
    const body = await req.json().catch(() => ({}));
    const contactId = parseInt(body?.contact_id, 10);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return NextResponse.json({ message: "A valid responsible person is required." }, { status: 400, headers: NO_STORE });
    }
    const [person] = await query("SELECT id, person_name, phone_number FROM contacts WHERE id = ?", [contactId]);
    if (!person) return NextResponse.json({ message: "Responsible person not found." }, { status: 404, headers: NO_STORE });

    const vacancies = await pendingVacanciesForResponsible(session, contactId);
    if (!vacancies.length) {
      return NextResponse.json({ message: "No pending vacancies for this responsible person." }, { status: 400, headers: NO_STORE });
    }

    const groupKey = groupKeyFor(contactId);
    const message = buildReminderMessage(vacancies);
    const wa = toWhatsAppNumber(person.phone_number);

    if (!wa) {
      // Cannot deliver — record FAILED, do not pretend it was sent.
      await recordReminder({
        group_key: groupKey, responsible_contact_id: contactId, responsible_name: person.person_name,
        responsible_mobile: person.phone_number || null, status: "failed", message, sent_by: session.user.id || null,
      });
      return NextResponse.json(
        { status: "failed", message: "This responsible person has no valid WhatsApp/mobile number on record." },
        { status: 200, headers: NO_STORE }
      );
    }

    const record = await recordReminder({
      group_key: groupKey, responsible_contact_id: contactId, responsible_name: person.person_name,
      responsible_mobile: person.phone_number, status: "sent", message, sent_by: session.user.id || null,
    });
    const wa_url = `https://wa.me/${wa}?text=${encodeURIComponent(message)}`;
    return NextResponse.json(
      { status: "sent", wa_url, message, reminder: record, count: vacancies.length },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error("[vacancies] remind POST error:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

export async function GET(req) {
  try {
    const { error } = await guard();
    if (error) return error;
    const { searchParams } = new URL(req.url);
    const contactId = parseInt(searchParams.get("contact_id"), 10);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return NextResponse.json({ message: "A valid responsible person is required." }, { status: 400, headers: NO_STORE });
    }
    const history = await reminderHistory(groupKeyFor(contactId));
    return NextResponse.json({ history }, { headers: NO_STORE });
  } catch (err) {
    console.error("[vacancies] remind GET error:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
