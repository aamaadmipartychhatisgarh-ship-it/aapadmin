import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query, getPool } from "@/lib/db";
import { syncContactToWorker } from "@/lib/workerSync";
import { logAudit } from "@/lib/audit";
import { emitLiveEvent, LIVE_EVENTS } from "@/lib/liveEvents";

// The contacts table has been extended over several migrations, and a given
// deployment may not have every column yet (e.g. assembly_id/booth_id). Naming
// a missing column in a single UPDATE aborts the whole statement, which would
// silently drop the caller's edit. So we intersect the requested fields with
// the columns that actually exist. Resolved once, then cached for the process.
let contactColumnsPromise;
async function getContactColumns() {
  if (!contactColumnsPromise) {
    contactColumnsPromise = query(
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts'`
    )
      .then((rows) => new Set(rows.map((r) => r.name)))
      .catch((err) => {
        // Don't cache a failure — let the next request retry the lookup.
        contactColumnsPromise = undefined;
        throw err;
      });
  }
  return contactColumnsPromise;
}

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const admin = isAdmin(session);
    if (!admin) {
      // Callers may edit the contact they currently hold (locked mid-call).
      // They can change every detail of the contact — name, phone, address,
      // designation and the full geography (zone/district/assembly/ward/booth) —
      // but never its queue assignment or completion state, and never delete it.
      const [row] = await query("SELECT locked_by_user_id FROM contacts WHERE id = ?", [id]);
      if (!row || String(row.locked_by_user_id) !== String(session.user.id)) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
      }
    }
    const data = await req.json();

    // Block/Ward is entered as free text in My Workplace. Resolve the typed name
    // to a `ward` location row (reuse an existing one under the same assembly,
    // case-insensitively, or create it) and store its id in ward_id — so the
    // value keeps displaying across Workers/Contacts/Reports, which read the
    // ward via that id. Empty text clears the ward.
    if ("ward_name" in data) {
      const wn = typeof data.ward_name === "string" ? data.ward_name.trim() : "";
      if (!wn) {
        data.ward_id = null;
      } else {
        const asm = ("assembly_id" in data && data.assembly_id) ? data.assembly_id : null;
        const found = await query(
          "SELECT id FROM locations WHERE type = 'ward' AND LOWER(name) = LOWER(?) AND (parent_id <=> ?) LIMIT 1",
          [wn, asm]
        );
        if (found[0]?.id) {
          data.ward_id = found[0].id;
        } else {
          const res = await query("INSERT INTO locations (type, name, parent_id) VALUES ('ward', ?, ?)", [wn, asm]);
          data.ward_id = res.insertId;
        }
      }
    }

    // Descriptive + geographic details anyone with edit rights may change.
    const DETAIL_FIELDS = [
      "person_name", "phone_number", "address", "designation_id",
      "zone_id", "lok_sabha_id", "district_id", "assembly_id", "ward_id", "booth_id",
    ];
    // Queue assignment + completion state stay admin-only (not "contact details").
    const ADMIN_ONLY_FIELDS = ["assigned_to_user_id", "is_completed"];
    const fields = admin ? [...DETAIL_FIELDS, ...ADMIN_ONLY_FIELDS] : DETAIL_FIELDS;
    // Only touch columns this deployment's schema actually has.
    const existingColumns = await getContactColumns();
    const sets = [];
    const vals = [];
    for (const f of fields) {
      if (f in data && existingColumns.has(f)) { sets.push(`${f} = ?`); vals.push(data[f] === "" ? null : data[f]); }
    }
    // Stamp assigned_at whenever the owner changes, so stale-reclaim can tell how
    // long a contact has been held (cleared when it returns to the pool).
    if (admin && "assigned_to_user_id" in data && existingColumns.has("assigned_at")) {
      sets.push(data.assigned_to_user_id ? "assigned_at = NOW()" : "assigned_at = NULL");
    }
    // Record WHO assigned it (for the caller's "Assigned by" line); cleared when
    // the contact returns to the pool.
    if (admin && "assigned_to_user_id" in data && existingColumns.has("assigned_by_user_id")) {
      if (data.assigned_to_user_id) { sets.push("assigned_by_user_id = ?"); vals.push(session.user.id); }
      else { sets.push("assigned_by_user_id = NULL"); }
    }
    if (sets.length === 0) return NextResponse.json({ message: "No fields to update" }, { status: 400 });

    // Apply the contact edit and mirror it onto the linked worker (matched by the
    // stable worker_id, falling back to phone) atomically — both commit or neither
    // does. syncContactToWorker updates every mapped field incl. the designation,
    // and creates + links a worker if the person has none yet, so a My Workplace
    // edit is always reflected in the Workers module. Returns the fresh contact.
    const pool = getPool();
    const conn = await pool.getConnection();
    let updated;
    try {
      await conn.beginTransaction();
      vals.push(id);
      await conn.query(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`, vals);
      await syncContactToWorker(conn, id);
      const [rows] = await conn.query("SELECT * FROM contacts WHERE id = ?", [id]);
      updated = rows[0];
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    if (admin && "assigned_to_user_id" in data && data.assigned_to_user_id) {
      emitLiveEvent(LIVE_EVENTS.CONTACT_ASSIGNED, { count: 1, contact_id: id });
    }
    // Return the latest saved record so the client never shows stale data.
    return NextResponse.json({ ok: true, contact: updated });
  } catch (err) {
    console.error("contacts PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const [existing] = await query("SELECT person_name, phone_number FROM contacts WHERE id = ?", [id]);
    await query("DELETE FROM contacts WHERE id = ?", [id]);
    await logAudit(session, { action: "contact.delete", entityType: "contact", entityId: id, details: existing || null });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("contacts DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
