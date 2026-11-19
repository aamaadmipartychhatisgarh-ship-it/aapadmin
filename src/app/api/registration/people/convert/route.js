import { NextResponse } from "next/server";
import { requireRegistrationAccess, NO_STORE } from "@/lib/registrationGuard";
import { pageAllowed } from "@/lib/pageAccess";
import { isAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { convertRegistrationToContact } from "@/lib/registrationConvert";

export const dynamic = "force-dynamic";

const MAX_BULK = 500;

// POST { ids: [registration ids] } — BULK "Convert to Contact". Same access rule as the single convert (the Registration module
// + the right to create Contacts). Each registration is converted on its own with the SAME locked, re-checked logic as the
// single button (lib/registrationConvert): only Workers rated 8/10 or higher, counted, not yet converted; an existing Contact
// with the same mobile is linked, never duplicated. One failure never stops the rest; every id gets its own result.
export async function POST(req) {
  try {
    const { session, error } = await requireRegistrationAccess();
    if (error) return error;
    if (!(await pageAllowed(session, "contacts", isAdmin(session)))) {
      return NextResponse.json({ message: "You do not have permission to create Contacts." }, { status: 403, headers: NO_STORE });
    }
    const body = await req.json().catch(() => ({}));
    const ids = [...new Set((Array.isArray(body?.ids) ? body.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (!ids.length) return NextResponse.json({ message: "Select at least one worker to convert." }, { status: 400, headers: NO_STORE });
    if (ids.length > MAX_BULK) return NextResponse.json({ message: `At most ${MAX_BULK} workers can be converted at once.` }, { status: 400, headers: NO_STORE });

    const names = new Map((await query(`SELECT id, name FROM reg_people WHERE id IN (${ids.map(() => "?").join(",")})`, ids)).map((r) => [Number(r.id), r.name]));
    const results = [];
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const r = await convertRegistrationToContact({ registrationId: id, userId: session.user.id }).catch((e) => ({ status: 500, message: e?.message || "Error" }));
      const ok = r.status === 201 || r.status === 200;
      results.push({ id, name: names.get(id) || null, ok, created: r.status === 201, linked: !!r.linked_existing, contact_id: r.contact_id || null, message: r.message });
    }
    const created = results.filter((x) => x.created).length;
    const linked = results.filter((x) => x.ok && !x.created).length;
    const failed = results.length - created - linked;
    await logAudit(session, {
      action: "registration.bulk_convert_to_contact", entityType: "reg_people", entityId: null,
      details: { ids, created, linked, failed },
    }).catch(() => {});
    const parts = [`${created} converted to Contact${created === 1 ? "" : "s"}`];
    if (linked) parts.push(`${linked} linked to an existing Contact`);
    if (failed) parts.push(`${failed} not converted`);
    return NextResponse.json({ message: `${parts.join(" · ")}.`, created, linked, failed, results }, { headers: NO_STORE });
  } catch (err) {
    console.error("registration bulk convert error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
