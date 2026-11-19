import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { normalizeRole, ROLES } from "@/lib/permissions";
import { callerZoneAccess, zoneContactClause } from "@/lib/callerZoneScope";
import { ensureContactWingsSchema } from "@/lib/contactWings";
import { listWings } from "@/lib/wingDesignations";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const MAX = 500;

// POST /api/zone-contacts/wings { contact_ids: [..], wing: "<Wing name>", action: "add" | "remove" }
// Caller Dashboard → Zone Contacts: put selected contacts into a Wing, or take them out of one. The Wing must be one of the
// Wings of Master Data (the same list the Contact section uses — never free text). The tag is the contact's own Wing
// (contact_wings), exactly what the Contact section's Wings field writes, so the Contact List, its Wing filter and this page
// all read the same value.
// Only contacts of the caller's OWN Zone that are in the pool or assigned to this caller can be changed; anything else is
// skipped with a reason. Removing a Wing the contact holds a Designation under is refused for that contact (the Designation
// itself belongs to that Wing — change it in the Contact section).
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (normalizeRole(session.user.role) !== ROLES.CALLER) return NextResponse.json({ message: "Only a Caller can manage Wings here." }, { status: 403, headers: NO_STORE });
    const zone = await callerZoneAccess(session);
    if (!zone) return NextResponse.json({ message: "You do not have access to Zone Contacts." }, { status: 403, headers: NO_STORE });
    if (!zone.zoneId) return NextResponse.json({ message: "You have no Zone assigned." }, { status: 403, headers: NO_STORE });

    const body = await req.json().catch(() => ({}));
    const action = body.action === "remove" ? "remove" : body.action === "add" ? "add" : null;
    if (!action) return NextResponse.json({ message: "Choose Add or Remove." }, { status: 400, headers: NO_STORE });
    const ids = [...new Set((Array.isArray(body.contact_ids) ? body.contact_ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (!ids.length) return NextResponse.json({ message: "Select at least one contact." }, { status: 400, headers: NO_STORE });
    if (ids.length > MAX) return NextResponse.json({ message: `Select at most ${MAX} contacts at a time.` }, { status: 400, headers: NO_STORE });
    const master = (await listWings()).filter((w) => w.enabled == null || Number(w.enabled) === 1);
    const wing = master.find((w) => String(w.name).trim().toLowerCase() === String(body.wing || "").trim().toLowerCase());
    if (!wing) return NextResponse.json({ message: "Pick a Wing from the list." }, { status: 400, headers: NO_STORE });

    await ensureContactWingsSchema();
    const z = zoneContactClause(zone.zoneId, "c");
    const me = Number(session.user.id);
    const rows = await query(
      `SELECT c.id, c.person_name, c.assigned_to_user_id FROM contacts c WHERE c.id IN (${ids.map(() => "?").join(",")}) ${z.where}`,
      [...ids, ...z.params]
    );
    const byId = new Map(rows.map((r) => [Number(r.id), r]));
    const changed = [], skipped = [];
    for (const id of ids) {
      const c = byId.get(id);
      if (!c) { skipped.push({ id, reason: "not in your Zone" }); continue; }
      if (c.assigned_to_user_id != null && Number(c.assigned_to_user_id) !== me) { skipped.push({ id, name: c.person_name, reason: "assigned to another user" }); continue; }
      if (action === "add") {
        // eslint-disable-next-line no-await-in-loop
        const r = await query("INSERT IGNORE INTO contact_wings (contact_id, wing) VALUES (?, ?)", [id, wing.name]);
        if (r.affectedRows) changed.push(id); else skipped.push({ id, name: c.person_name, reason: `already in ${wing.name}` });
      } else {
        // eslint-disable-next-line no-await-in-loop
        const held = await query("SELECT 1 FROM contact_designations WHERE contact_id = ? AND wing = ? LIMIT 1", [id, wing.name]).catch(() => []);
        if (held.length) { skipped.push({ id, name: c.person_name, reason: `holds a Designation in ${wing.name}` }); continue; }
        // eslint-disable-next-line no-await-in-loop
        const r = await query("DELETE FROM contact_wings WHERE contact_id = ? AND wing = ?", [id, wing.name]);
        if (r.affectedRows) changed.push(id); else skipped.push({ id, name: c.person_name, reason: `not in ${wing.name}` });
      }
    }
    if (changed.length) {
      await logAudit(session, {
        action: action === "add" ? "zone_contacts.wing_add" : "zone_contacts.wing_remove", entityType: "contact", entityId: null,
        details: { wing: wing.name, contact_ids: changed },
      }).catch(() => {});
    }
    const verb = action === "add" ? `added to ${wing.name}` : `removed from ${wing.name}`;
    let message = `${changed.length} contact${changed.length === 1 ? "" : "s"} ${verb}.`;
    if (skipped.length) message += ` ${skipped.length} skipped (${[...new Set(skipped.map((s) => s.reason))].join("; ")}).`;
    return NextResponse.json({ message, changed_ids: changed, skipped }, { headers: NO_STORE });
  } catch (err) {
    console.error("zone-contacts wings error:", err);
    return NextResponse.json({ message: "Could not update the Wings. Nothing was changed." }, { status: 500, headers: NO_STORE });
  }
}
