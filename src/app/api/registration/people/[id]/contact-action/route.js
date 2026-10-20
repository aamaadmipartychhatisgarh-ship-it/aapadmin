import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRegistrationAccess, NO_STORE } from "@/lib/registrationGuard";
import { assemblyInCallerScope } from "@/lib/registrationScope";
import { ensureRegistrationSchema } from "@/lib/registrationSchema";
import { normalizeContactAction, recordContactAction } from "@/lib/registrationContactAction";

// POST { action: call|sms|whatsapp } — the signed-in user INITIATED a communication
// action on this registration from the Registrations list. Same access rule as
// editing it (a caller only within their territory). Records the click only.
export const dynamic = "force-dynamic";

export async function POST(req, { params }) {
  try {
    const { error, session } = await requireRegistrationAccess();
    if (error) return error;
    await ensureRegistrationSchema();
    const { id } = await params;
    const [rec] = await query("SELECT id, assembly_id FROM reg_people WHERE id = ?", [id]);
    if (!rec || !(await assemblyInCallerScope(session, rec.assembly_id))) {
      return NextResponse.json({ message: "Not found." }, { status: 404, headers: NO_STORE });
    }
    const d = await req.json().catch(() => null);
    const action = normalizeContactAction(d?.action);
    if (!action) return NextResponse.json({ message: "Invalid action." }, { status: 400, headers: NO_STORE });
    const row = await recordContactAction(rec.id, action, { userId: Number(session.user.id) || null });
    return NextResponse.json({ ok: true, person: row }, { headers: NO_STORE });
  } catch (e) {
    console.error("[registration] contact action (admin) error:", e);
    return NextResponse.json({ message: "Could not record the action." }, { status: 500, headers: NO_STORE });
  }
}
