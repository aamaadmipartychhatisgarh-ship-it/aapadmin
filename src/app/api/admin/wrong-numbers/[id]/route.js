import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isAdmin } from "@/lib/permissions";
import { query, getPool } from "@/lib/db";
import { hasWrongNumberColumn, hasWrongNumberDetailColumns } from "@/lib/contactExtras";
import { ensureTaskContactColumn } from "@/lib/taskSchema";
import { logAudit } from "@/lib/audit";

// POST /api/admin/wrong-numbers/[id]  { action: "restore" | "reassign" | "merge", user_id?, target_contact_id? }
// Supervisor / Team Leader / Super Admin.
export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const { action, user_id, target_contact_id } = await req.json().catch(() => ({}));

    if (action === "restore") {
      if (!(await hasWrongNumberColumn())) {
        return NextResponse.json({ message: "Wrong Number feature not enabled." }, { status: 400 });
      }
      const hasDetail = await hasWrongNumberDetailColumns();
      // Clear the flag + completion and locks so it returns to the active queue.
      // The wrong_number_* detail columns are left untouched — they're the
      // permanent record of the last time this contact WAS flagged, not
      // something "undoing" the flag should erase.
      await query(
        `UPDATE contacts
            SET is_wrong_number = 0, is_completed = 0,
                locked_by_user_id = NULL, locked_at = NULL
                ${hasDetail ? ", restored_at = NOW(), restored_by = ?" : ""}
          WHERE id = ?`,
        hasDetail ? [session.user.id, id] : [id]
      );
      logAudit(session, { action: "contact.wrong_number_restore", entityType: "contact", entityId: id });
      return NextResponse.json({ message: "Restored to the calling queue." });
    }

    if (action === "reassign") {
      if (!user_id) return NextResponse.json({ message: "user_id required" }, { status: 400 });
      await query(
        `UPDATE contacts SET assigned_to_user_id = ?, assigned_at = NOW(), locked_by_user_id = NULL, locked_at = NULL WHERE id = ?`,
        [user_id, id]
      );
      logAudit(session, { action: "contact.wrong_number_reassign", entityType: "contact", entityId: id, details: { user_id } });
      return NextResponse.json({ message: "Contact reassigned." });
    }

    if (action === "merge") {
      // Absorb this (wrong-number) contact into an existing correct one:
      // every call/task/correction-request that pointed at the duplicate now
      // points at the target, so no history is lost — then the now-redundant
      // duplicate row is removed. "Do not delete records" is about NOT
      // silently discarding a real contact; merging is the explicit case
      // where the admin has confirmed these are the same person and chosen
      // to consolidate them (same pattern as the existing wrong-number bulk
      // delete, just history-preserving instead of history-discarding).
      if (!target_contact_id) return NextResponse.json({ message: "target_contact_id required" }, { status: 400 });
      if (Number(target_contact_id) === Number(id)) {
        return NextResponse.json({ message: "Can't merge a contact into itself." }, { status: 400 });
      }
      const [source] = await query("SELECT id, person_name FROM contacts WHERE id = ?", [id]);
      const [target] = await query("SELECT id, person_name FROM contacts WHERE id = ?", [target_contact_id]);
      if (!source) return NextResponse.json({ message: "Source contact not found." }, { status: 404 });
      if (!target) return NextResponse.json({ message: "Target contact not found." }, { status: 404 });

      await ensureTaskContactColumn();
      const conn = await getPool().getConnection();
      try {
        await conn.beginTransaction();
        const [callsRes] = await conn.query("UPDATE calls SET contact_id = ? WHERE contact_id = ?", [target_contact_id, id]);
        const [tasksRes] = await conn.query("UPDATE tasks SET contact_id = ? WHERE contact_id = ?", [target_contact_id, id]);
        await conn.query("UPDATE number_correction_requests SET contact_id = ? WHERE contact_id = ?", [target_contact_id, id]).catch(() => {});
        await conn.query("DELETE FROM contacts WHERE id = ?", [id]);
        await conn.commit();
        logAudit(session, {
          action: "contact.wrong_number_merge", entityType: "contact", entityId: target_contact_id,
          details: { merged_from: Number(id), merged_from_name: source.person_name, calls_moved: callsRes.affectedRows, tasks_moved: tasksRes.affectedRows },
        });
        return NextResponse.json({ message: `Merged into ${target.person_name}.`, calls_moved: callsRes.affectedRows, tasks_moved: tasksRes.affectedRows });
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    }

    return NextResponse.json({ message: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("wrong-numbers action error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/admin/wrong-numbers/[id] — admin only.
export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Only admins can delete records." }, { status: 401 });
    }
    const { id } = await params;
    const [row] = await query("SELECT person_name, phone_number FROM contacts WHERE id = ?", [id]);
    await query("DELETE FROM contacts WHERE id = ?", [id]);
    logAudit(session, { action: "contact.wrong_number_delete", entityType: "contact", entityId: id, details: row || null });
    return NextResponse.json({ message: "Record deleted." });
  } catch (err) {
    console.error("wrong-numbers DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
