import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSupervisorRole, normalizeRole, ROLES } from "@/lib/permissions";
import { query, getPool } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { emitLiveEvent, LIVE_EVENTS } from "@/lib/liveEvents";
import { supervisorScopeFilter, supervisorCallerScopeFilter } from "@/lib/supervisorScope";

// Supervisor-scoped mirror of PUT /api/contacts/[id] — assign/reassign a
// contact and edit its details, but ONLY within the supervisor's own
// territory. The scope clause is baked directly into the UPDATE's WHERE, so
// an out-of-territory contact id (typed into the URL, replayed from
// DevTools, whatever) is atomically unreachable — not just hidden from the
// list UI. `is_completed` is deliberately NOT editable here: the
// Supervisor's granted capabilities are assign/reassign/remove-assignment
// and edit contact details, not marking calls done (that's a caller/admin
// action elsewhere).
let contactColumnsPromise;
async function getContactColumns() {
  if (!contactColumnsPromise) {
    contactColumnsPromise = query(
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts'`
    )
      .then((rows) => new Set(rows.map((r) => r.name)))
      .catch((err) => { contactColumnsPromise = undefined; throw err; });
  }
  return contactColumnsPromise;
}

// Deliberately excludes zone_id/district_id/assembly_id/ward_id/booth_id —
// the UPDATE's WHERE scopes on the contact's CURRENT geography, which can't
// stop a supervisor from moving a contact's geography OUT of their territory
// via the SET clause (WHERE is evaluated against the row before the update).
// Rather than add a second scope check against the requested new values,
// geography simply isn't editable here — a supervisor can relocate/reassign
// WHO owns a contact, not WHERE it lives.
const DETAIL_FIELDS = ["person_name", "phone_number", "address", "designation_id"];

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisorRole(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const data = await req.json();

    if ("assigned_to_user_id" in data && data.assigned_to_user_id) {
      const callerScope = supervisorCallerScopeFilter(session.user, "u");
      const rows = await query(
        `SELECT id, role FROM users u WHERE u.id = ? ${callerScope.where}`,
        [data.assigned_to_user_id, ...callerScope.params]
      );
      const target = rows[0];
      if (!target || normalizeRole(target.role) !== ROLES.CALLER) {
        return NextResponse.json({ message: "That caller is not in your territory." }, { status: 403 });
      }
    }

    const fields = [...DETAIL_FIELDS, "assigned_to_user_id"];
    const existingColumns = await getContactColumns();
    const sets = [];
    const vals = [];
    for (const f of fields) {
      if (f in data && existingColumns.has(f)) { sets.push(`${f} = ?`); vals.push(data[f] === "" ? null : data[f]); }
    }
    if ("assigned_to_user_id" in data && existingColumns.has("assigned_at")) {
      sets.push(data.assigned_to_user_id ? "assigned_at = NOW()" : "assigned_at = NULL");
    }
    if ("assigned_to_user_id" in data && existingColumns.has("assigned_by_user_id")) {
      if (data.assigned_to_user_id) { sets.push("assigned_by_user_id = ?"); vals.push(session.user.id); }
      else { sets.push("assigned_by_user_id = NULL"); }
    }
    if (sets.length === 0) return NextResponse.json({ message: "No fields to update" }, { status: 400 });

    // Territory scope baked into the WHERE itself — an out-of-scope id
    // matches zero rows rather than ever being touched.
    const scope = supervisorScopeFilter(session.user, "c");

    const pool = getPool();
    const conn = await pool.getConnection();
    let updated;
    let affected = 0;
    try {
      await conn.beginTransaction();
      vals.push(id);
      const [result] = await conn.query(
        `UPDATE contacts c SET ${sets.join(", ")} WHERE c.id = ? ${scope.where}`,
        [...vals, ...scope.params]
      );
      affected = result.affectedRows;
      if (affected > 0) {
        const [rows] = await conn.query("SELECT * FROM contacts WHERE id = ?", [id]);
        updated = rows[0];
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    if (affected === 0) {
      return NextResponse.json({ message: "Contact not found or outside your territory." }, { status: 404 });
    }

    if ("assigned_to_user_id" in data && data.assigned_to_user_id) {
      emitLiveEvent(LIVE_EVENTS.CONTACT_ASSIGNED, { count: 1, contact_id: id });
    }
    await logAudit(session, { action: "contact.update", entityType: "contact", entityId: id, details: { supervisor: true, fields: Object.keys(data) } });
    return NextResponse.json({ ok: true, contact: updated });
  } catch (err) {
    console.error("supervisor contacts PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/supervisor/contacts/[id] — territory-scoped. The scope clause
// is baked into the DELETE's own WHERE (same pattern as PUT above), so an
// out-of-territory id is atomically unreachable rather than just hidden
// from the list UI.
export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisorRole(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const scope = supervisorScopeFilter(session.user, "c");
    const [existing] = await query(`SELECT person_name, phone_number FROM contacts c WHERE c.id = ? ${scope.where}`, [id, ...scope.params]);
    if (!existing) {
      return NextResponse.json({ message: "Contact not found or outside your territory." }, { status: 404 });
    }
    const res = await query(`DELETE FROM contacts c WHERE c.id = ? ${scope.where}`, [id, ...scope.params]);
    if (res.affectedRows === 0) {
      return NextResponse.json({ message: "Contact not found or outside your territory." }, { status: 404 });
    }
    await logAudit(session, { action: "contact.delete", entityType: "contact", entityId: id, details: { ...existing, supervisor: true } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("supervisor contacts DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
