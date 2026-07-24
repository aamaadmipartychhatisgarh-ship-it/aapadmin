import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

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
    if (sets.length === 0) return NextResponse.json({ message: "No fields to update" }, { status: 400 });

    // Remember the contact's current phone so we can find the linked worker even
    // if the phone is being changed here.
    const beforeRows = await query("SELECT phone_number FROM contacts WHERE id = ?", [id]);
    const oldPhone = beforeRows[0]?.phone_number || null;

    vals.push(id);
    await query(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`, vals);

    // Keep the linked Worker in sync (same person, matched by mobile). We sync
    // name/phone/address/geography, but NOT the worker's `position` (it can hold
    // several designations, which a single contact designation_id can't represent).
    try {
      const newPhone = ("phone_number" in data)
        ? (data.phone_number ? String(data.phone_number).trim().replace(/[^\d+]/g, "") : null)
        : oldPhone;
      const matchPhone = oldPhone || newPhone;
      if (matchPhone) {
        const [w] = await query("SELECT id FROM workers WHERE mobile = ? LIMIT 1", [matchPhone]);
        if (w) {
          const map = { person_name: "name", phone_number: "mobile", address: "address",
            zone_id: "zone_id", lok_sabha_id: "lok_sabha_id", district_id: "district_id",
            assembly_id: "assembly_id", ward_id: "ward_id", booth_id: "booth_id" };
          const wSets = [], wVals = [];
          for (const [cField, wField] of Object.entries(map)) {
            if (cField in data) {
              wSets.push(`${wField} = ?`);
              wVals.push(cField === "phone_number" ? newPhone : (data[cField] === "" ? null : data[cField]));
            }
          }
          if (wSets.length) { wVals.push(w.id); await query(`UPDATE workers SET ${wSets.join(", ")} WHERE id = ?`, wVals); }
        }
      }
    } catch (e) {
      console.error("contact->worker sync error:", e);
    }

    return NextResponse.json({ ok: true });
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
    await query("DELETE FROM contacts WHERE id = ?", [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("contacts DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
