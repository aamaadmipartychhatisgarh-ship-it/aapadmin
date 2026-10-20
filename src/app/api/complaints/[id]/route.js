import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isCaller, scopeFilterSync } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { ensureComplaintColumns } from "../route";
import { resolveComplaintLocation, assembliesForPhones } from "@/lib/complaintWorker";
import { phoneKey } from "@/lib/phone";

// GET /api/complaints/[id] — ONE complaint with every detail, looked up by its
// unique id (never by name, so duplicate complainant names cannot open the wrong
// record). Same access rule as the list: complaints page access (oversight or
// caller) AND the same geographic scope — a complaint outside the viewer's area is
// reported as not found, so nothing about it leaks.
export async function GET(_req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "complaints", session && (isOversight(session) || isCaller(session))))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    await ensureComplaintColumns();
    const { id } = await params;
    const cid = Number(id);
    if (!Number.isInteger(cid) || cid <= 0) return NextResponse.json({ message: "Complaint not found." }, { status: 404 });
    const scope = scopeFilterSync(session.user, "c", { cols: ["district_id", "assembly_id"] });
    const [c] = await query(
      `SELECT c.*, ld.name AS district_name, la.name AS assembly_name, t.name AS team_name, dg.name AS designation_name,
              TIMESTAMPDIFF(HOUR, c.created_at, NOW()) AS age_hours
         FROM complaints c
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations la ON la.id = c.assembly_id
         LEFT JOIN teams t ON t.id = c.assigned_team_id
         LEFT JOIN designations dg ON dg.id = c.designation_id
        WHERE c.id = ? ${scope.where || ""}
        LIMIT 1`,
      [cid, ...scope.params]
    );
    if (!c) return NextResponse.json({ message: "Complaint not found." }, { status: 404 });
    // Same Assembly rule as the list: saved value, else the unambiguous worker's.
    if (c.assembly_id == null && c.citizen_phone) {
      const d = (await assembliesForPhones([c.citizen_phone])).get(phoneKey(c.citizen_phone));
      if (d) c.assembly_name = d.name;
    }
    const age = Number(c.age_hours) || 0;
    const unresolved = c.status === "open" || c.status === "in_progress";
    return NextResponse.json({ complaint: { ...c, age_hours: age, overdue: unresolved && age >= 72 } });
  } catch (err) {
    console.error("complaint GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensureComplaintColumns();
    const { id } = await params;
    const d = await req.json();
    // Editable fields — includes the citizen/person details the edit modal sends
    // (previously omitted, so editing name/phone/district silently didn't save).
    const fields = ["citizen_name", "citizen_phone", "district_id", "status", "assigned_team_id", "resolution_notes", "type", "description", "designation_id"];
    const sets = [], vals = [];
    for (const f of fields) if (f in d) { sets.push(`${f} = ?`); vals.push(d[f] === "" ? null : d[f]); }
    // The Assembly follows the Worker behind the complaint's mobile number. It is
    // re-derived ONLY when the phone number actually changes (or a worker is chosen
    // explicitly), so editing any other field never alters the saved Assembly, and a
    // changed number can never keep the previous person's Assembly.
    if ("citizen_phone" in d || "contact_id" in d) {
      const [cur] = await query("SELECT citizen_phone FROM complaints WHERE id = ?", [id]);
      const newPhone = "citizen_phone" in d ? d.citizen_phone : cur?.citizen_phone;
      const changed = "contact_id" in d || phoneKey(newPhone) !== phoneKey(cur?.citizen_phone);
      if (changed) {
        const loc = await resolveComplaintLocation({ phone: newPhone, contactId: d.contact_id });
        sets.push("assembly_id = ?"); vals.push(loc.assembly_id);
        if (loc.district_id && !d.district_id) { sets.push("district_id = ?"); vals.push(loc.district_id); }
      }
    }
    if (d.status === "resolved" || d.status === "closed") sets.push("resolved_at = NOW()");
    if (!sets.length) return NextResponse.json({ message: "No fields" }, { status: 400 });
    vals.push(id);
    await query(`UPDATE complaints SET ${sets.join(", ")} WHERE id = ?`, vals);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("complaint PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/complaints/[id] — permanently remove ONE complaint. Restricted to
// oversight roles (same as editing). The row is deleted by its exact id, so the
// correct record is removed regardless of the client's row/index order.
export async function DELETE(_req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const [existing] = await query("SELECT id FROM complaints WHERE id = ?", [id]);
    if (!existing) return NextResponse.json({ message: "Complaint not found." }, { status: 404 });
    await query("DELETE FROM complaints WHERE id = ?", [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("complaint DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
