import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { resolveActingUserId } from "@/lib/actAs";
import { query, getPool } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { emitLiveEvent, LIVE_EVENTS } from "@/lib/liveEvents";
import { phoneAlreadyRegistered, duplicatePhoneResponse } from "@/lib/contactDuplicate";
import { resolveContactCard } from "@/lib/contactCard";
import { parseDesignationIds, syncContactDesignations } from "@/lib/contactDesignations";

// GET /api/contacts/[id] — fetch ONE contact by its unique database id, with the
// same resolved fields the workspace edit form needs (ward/district names +
// linked worker photo). This is the record-by-id path the "Edit in Workspace"
// flow relies on: unlike claim (which only opens a contact that's still
// claimable for a live call, and locks it), this loads the record for editing
// even when it's already completed or not currently locked — so the edit screen
// can show every existing detail instead of failing. Authorization mirrors the
// PUT: admins may read any contact; a caller may read a contact they hold the
// lock on OR that is assigned to them (the correct caller/workspace relationship).
export async function GET(_req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    if (!isAdmin(session)) {
      const { userId } = await resolveActingUserId(session);
      const [row] = await query("SELECT locked_by_user_id, assigned_to_user_id FROM contacts WHERE id = ?", [id]);
      const mine = row && (String(row.locked_by_user_id) === String(userId) || String(row.assigned_to_user_id) === String(userId));
      if (!mine) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Fully-resolved single record (all display names) — same shape the list
    // and the PUT response use, so every surface reads identical data.
    const contact = await resolveContactCard(id);
    if (!contact) return NextResponse.json({ message: "Contact not found." }, { status: 404 });
    return NextResponse.json({ contact });
  } catch (err) {
    console.error("contact GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

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
      // Callers may edit a contact they currently hold (locked mid-call) OR one
      // that is assigned to them — so editing from My Calls works even after the
      // contact was completed / the lock expired, matching the caller/workspace
      // relationship. They can change every detail (name, phone, address,
      // designation and the full geography) but never its queue assignment or
      // completion state, and never delete it. resolveActingUserId keeps
      // Super-Admin "view as caller" working.
      const { userId } = await resolveActingUserId(session);
      const [row] = await query("SELECT locked_by_user_id, assigned_to_user_id FROM contacts WHERE id = ?", [id]);
      const mine = row && (String(row.locked_by_user_id) === String(userId) || String(row.assigned_to_user_id) === String(userId));
      if (!mine) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
      }
    }
    const data = await req.json();

    // Multi-designation (PROMPT 5): when designation_ids[] is present, the join
    // table is fully synced below and the legacy primary column is kept aligned
    // to the FIRST id (or null). Adding/removing one only changes the set — the
    // others stay.
    let designationIds = null;
    if ("designation_ids" in data) {
      designationIds = parseDesignationIds(data.designation_ids);
      data.designation_id = designationIds[0] || null; // primary mirrors first
    }

    // Editing may keep the contact's OWN mobile (same row) but must not collide
    // with a DIFFERENT contact's number — exceptId excludes this contact.
    if ("phone_number" in data && String(data.phone_number ?? "").trim()
        && await phoneAlreadyRegistered(data.phone_number, id)) {
      return duplicatePhoneResponse();
    }

    // The profile modal always sends the contact's CURRENT assigned_to_user_id
    // even when only another field changed (e.g. designation). Drop it when it's
    // unchanged so an unrelated edit doesn't needlessly restamp assigned_at /
    // assigned_by — keeping behavior identical to the supervisor route.
    if (admin && "assigned_to_user_id" in data) {
      const [cur] = await query("SELECT assigned_to_user_id FROM contacts WHERE id = ?", [id]);
      const current = cur?.assigned_to_user_id ?? null;
      const incoming = data.assigned_to_user_id || null;
      if (String(current ?? "") === String(incoming ?? "")) delete data.assigned_to_user_id;
    }

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
      "person_name", "phone_number", "address", "pincode", "village", "remarks", "designation_id", "photo_url",
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

    // Apply the contact edit. Returns the fresh contact.
    const pool = getPool();
    const conn = await pool.getConnection();
    let updated;
    try {
      await conn.beginTransaction();
      vals.push(id);
      await conn.query(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`, vals);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    // Sync the full designation set (add/remove keeps the rest; empty clears).
    if (designationIds !== null) await syncContactDesignations(id, designationIds);

    if (admin && "assigned_to_user_id" in data && data.assigned_to_user_id) {
      emitLiveEvent(LIVE_EVENTS.CONTACT_ASSIGNED, { count: 1, contact_id: id });
    }
    // Return the FULLY-RESOLVED record (all *_name display fields, assigned-to
    // username, resolved photo) — the exact shape the list renders — so the
    // client replaces its row with fresh data and never shows a stale name.
    updated = await resolveContactCard(id);
    return NextResponse.json({ ok: true, contact: updated });
  } catch (err) {
    console.error("contacts PUT error:", err);
    if (err?.code === "ER_DUP_ENTRY") return duplicatePhoneResponse();
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
