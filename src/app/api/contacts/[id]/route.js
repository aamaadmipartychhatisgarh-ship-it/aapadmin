import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, isOversight } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { resolveActingUserId } from "@/lib/actAs";
import { ensurePhotoVerifiedColumn } from "@/lib/contactPhotoRecovery";
import { query, getPool } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { emitLiveEvent, LIVE_EVENTS } from "@/lib/liveEvents";
import { phoneAlreadyRegistered, duplicatePhoneResponse } from "@/lib/contactDuplicate";
import { isContactNotInterested } from "@/lib/contactExtras";
import { isContactRepeatOff } from "@/lib/repeatOff";
import { resolveContactCard } from "@/lib/contactCard";
import { syncContactDesignations, designationsForGeneralEdit } from "@/lib/contactDesignations";
import { syncContactWings } from "@/lib/contactWings";
import { contactEffectiveZoneId, releaseOutOfZoneAssignment } from "@/lib/contactZone";
import { photoForGeneralEdit } from "@/lib/contactPhotoUrl";
import { addressForGeneralEdit } from "@/lib/contactAddress";
import { resolveOrCreateWard } from "@/lib/contactLocation";
import { deleteLocalUpload } from "@/lib/uploadCleanup";
import { ensureQualificationColumns, normalizeQualification } from "@/lib/contactQualification";
import { ensureVehicleColumn, normalizeVehicle } from "@/lib/contactVehicle";
import { callerOwnsContact } from "@/lib/callerContactAccess";
import { callerCanReadContact } from "@/lib/callerZoneScope";

// GET /api/contacts/[id] — fetch ONE contact by its unique database id, with the
// same resolved fields the workspace edit form needs (ward/district names +
// linked worker photo). This is the record-by-id path the "Edit in Workspace"
// flow relies on: unlike claim (which only opens a contact that's still
// claimable for a live call, and locks it), this loads the record for editing
// even when it's already completed or not currently locked — so the edit screen
// can show every existing detail instead of failing. Authorization mirrors the
// PUT: admins may read any contact; a caller may read a contact they hold the
// lock on OR that is assigned to them (the correct caller/workspace relationship).
// The caller access rule lives in lib/callerContactAccess (shared with the photo
// route).

export async function GET(_req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    // Admins AND Supervisors (oversight) — or a "contacts" Page-Access grant —
    // get full Contact-Details access; otherwise a caller may only read a contact
    // they hold or that is assigned to them. (isOversight covers the Supervisor
    // role explicitly, so a supervisor can open any contact to edit it.)
    const canManage = await pageAllowed(session, "contacts", session && isOversight(session));
    if (!canManage) {
      // A caller may READ their own working contact, or any contact of their
      // current Zone (Zone Contacts page). Editing (PUT) is unchanged below.
      const { userId } = await resolveActingUserId(session);
      const allowed = await callerCanReadContact(session, id, userId);
      if (!allowed) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Fully-resolved single record (all display names) — same shape the list
    // and the PUT response use, so every surface reads identical data.
    const contact = await resolveContactCard(id);
    if (!contact) return NextResponse.json({ message: "Contact not found." }, { status: 404 });
    // NOTE: the photo reference is intentionally NOT auto-cleared here. Loading a
    // contact must never delete/blank its photo reference — a freshly re-uploaded
    // photo (or one briefly unreachable due to a transient storage hiccup) could be
    // wrongly dropped. The UI already shows the correct state from the actual image
    // load (View/Remove appear only when the image loads), and genuinely-dead
    // references are cleaned only by the explicit Photo Data recovery or when the
    // user clicks Remove — never automatically on a view.
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
    // Admins + Supervisors (oversight) OR a "contacts" Page-Access grant → full
    // management of any contact, INCLUDING removing the Address. isOversight covers
    // the Supervisor role explicitly (the Address spec: only Caller + Supervisor
    // edit; a Supervisor may also REMOVE the Address).
    const canManage = await pageAllowed(session, "contacts", session && isOversight(session));
    // Queue assignment + completion state stay strictly admin-tier (not supervisors).
    const isAdminTier = isAdmin(session);
    if (!canManage) {
      // Callers may edit a contact they currently hold (locked mid-call) OR one
      // that is assigned to them — so editing from My Calls works even after the
      // contact was completed / the lock expired, matching the caller/workspace
      // relationship. They can change every detail (name, phone, address,
      // designation and the full geography) but never its queue assignment or
      // completion state, and never delete it. A caller may UPDATE the Address but
      // cannot REMOVE it (see the address guard below). resolveActingUserId keeps
      // Super-Admin "view as caller" working.
      const { userId } = await resolveActingUserId(session);
      const mine = await callerOwnsContact(id, userId);
      if (!mine) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
      }
    }
    const data = await req.json();

    // ADDRESS PERSISTENCE RULE (spec): a Caller may update the Address to a new
    // value but must NOT be able to remove it — only a Supervisor/Admin may clear
    // it, and it stays saved until they do. So if a non-managing editor (a caller)
    // sends a blank/empty address, drop it from the payload: the stored address is
    // preserved instead of being wiped by an empty save, a page that didn't load
    // it, or an unrelated field edit. Managers (Supervisor/Admin) keep the ability
    // to clear it.
    // (Handled below by addressForGeneralEdit: a blank never clears unless the form was opened with an
    // address and deliberately emptied it, and only managers may do that.)

    // A Not-Interested contact cannot be (re)assigned to a User/Worker — the
    // restriction is enforced here, server-side, not just by hiding it in lists.
    // Assigning is only blocked when a new owner is being set; clearing the
    // assignment (or any non-assignment edit) is still allowed.
    if ("assigned_to_user_id" in data && data.assigned_to_user_id && await isContactNotInterested(id)) {
      return NextResponse.json(
        { message: "This contact is in Not Interested and cannot be assigned. Restore it first." },
        { status: 409 }
      );
    }
    // Same backend restriction for a contact in a 10+ Switch Off / Incoming Off list.
    if ("assigned_to_user_id" in data && data.assigned_to_user_id && await isContactRepeatOff(id)) {
      return NextResponse.json(
        { message: "This contact is in a 10+ Times Switch Off / Incoming Off list and cannot be assigned. Restore it first." },
        { status: 409 }
      );
    }

    // Multi-designation (PROMPT 5): when designation_ids[] is present, the join
    // table is fully synced below and the legacy primary column is kept aligned
    // to the FIRST id (or null). Adding/removing one only changes the set — the
    // others stay.
    // The designation set / primary are written only when the user actually CHANGED them
    // (designationsForGeneralEdit): an edit of another field never rewrites or clears them, a stale
    // form can't revert a newer designation, and removing all designations needs a deliberate
    // manager edit. The Caller workspace's single designation_id follows the same rule.
    let designationIds = null, designationConflict = false;
    {
      const dres = await designationsForGeneralEdit(id, data, canManage);
      if (dres.error) return NextResponse.json({ message: dres.error }, { status: 400 });
      designationConflict = !!dres.conflict;
      if (dres.skip) { delete data.designation_ids; delete data.designation_id; }
      else if (dres.ids) { designationIds = dres.ids; data.designation_id = dres.ids[0] || null; } // primary mirrors first
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
    if (isAdminTier && "assigned_to_user_id" in data) {
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
      data.ward_id = await resolveOrCreateWard(data.ward_name, ("assembly_id" in data && data.assembly_id) ? data.assembly_id : null);
    }

    // Qualification (Illiterate / Literate + education level). Validated and normalised
    // server-side: Illiterate always clears the education level.
    const qual = normalizeQualification(data);
    if (qual.error) return NextResponse.json({ message: qual.error }, { status: 400 });
    if (qual.present) { await ensureQualificationColumns(); data.qualification = qual.qualification; data.education_level = qual.education_level; }
    // Vehicle (Two Wheeler / Four Wheeler) — validated; blank clears it.
    const veh = normalizeVehicle(data);
    if (veh.error) return NextResponse.json({ message: veh.error }, { status: 400 });
    if (veh.present) { await ensureVehicleColumn(); data.vehicle = veh.vehicle; }

    // Descriptive + geographic details anyone with edit rights may change.
    const DETAIL_FIELDS = ["qualification", "education_level", "vehicle", 
      "person_name", "phone_number", "pincode", "village", "remarks", "designation_id",
      "zone_id", "lok_sabha_id", "district_id", "assembly_id", "ward_id", "booth_id",
    ];
    // Queue assignment + completion state stay admin-only (not "contact details").
    const ADMIN_ONLY_FIELDS = ["assigned_to_user_id", "is_completed"];
    const fields = isAdminTier ? [...DETAIL_FIELDS, ...ADMIN_ONLY_FIELDS] : DETAIL_FIELDS;
    // Only touch columns this deployment's schema actually has.
    const existingColumns = await getContactColumns();
    const sets = [];
    const vals = [];
    for (const f of fields) {
      if (!(f in data) || !existingColumns.has(f)) continue;
      // photo_url is NEVER blanked by a general contact edit. ROOT CAUSE of
      // "photos disappear over time": an edit made for another reason (e.g. an
      // address change) whose payload carries photo_url as "" / null would null
      // the pointer here, so the contact stops showing a photo whose blob still
      // exists. Setting/removing a photo goes through the dedicated
      // /api/contacts/[id]/photo endpoint; a blank value here means "leave it".
      sets.push(`${f} = ?`); vals.push(data[f] === "" ? null : data[f]);
    }
    // Stamp assigned_at whenever the owner changes, so stale-reclaim can tell how
    // long a contact has been held (cleared when it returns to the pool).
    if (isAdminTier && "assigned_to_user_id" in data && existingColumns.has("assigned_at")) {
      sets.push(data.assigned_to_user_id ? "assigned_at = NOW()" : "assigned_at = NULL");
    }
    // Record WHO assigned it (for the caller's "Assigned by" line); cleared when
    // the contact returns to the pool.
    if (isAdminTier && "assigned_to_user_id" in data && existingColumns.has("assigned_by_user_id")) {
      if (data.assigned_to_user_id) { sets.push("assigned_by_user_id = ?"); vals.push(session.user.id); }
      else { sets.push("assigned_by_user_id = NULL"); }
    }
    // ADDRESS: written only when the user actually edited it (see addressForGeneralEdit) — an edit of
    // another field never rewrites it, a stale form can't revert a newer address, and removing it
    // needs a deliberate manager edit.
    let addressConflict = false;
    if ("address" in data && existingColumns.has("address")) {
      const [curAddr] = await query("SELECT address FROM contacts WHERE id = ?", [id]);
      const ar = addressForGeneralEdit(data, curAddr?.address, canManage);
      if (ar.value !== undefined) { sets.push("address = ?"); vals.push(ar.value); }
      addressConflict = !!ar.conflict;
    }
    // PHOTO: a general edit never changes the photo, except to attach one just uploaded in
    // the same form (and never reverting a newer photo from a stale form) — see
    // photoForGeneralEdit. Setting/removing a photo otherwise goes through the photo endpoint.
    let photoSet = null, photoIgnored = false, oldPhotoForCleanup = null;
    if ("photo_url" in data && existingColumns.has("photo_url")) {
      const [curPhoto] = await query("SELECT photo_url FROM contacts WHERE id = ?", [id]);
      const pd = await photoForGeneralEdit(data, curPhoto?.photo_url);
      photoSet = pd.set; photoIgnored = pd.ignored;
      if (photoSet) { sets.push("photo_url = ?"); vals.push(photoSet); oldPhotoForCleanup = curPhoto?.photo_url || null; }
    }
    if (sets.length === 0) {
      // Nothing to write because the only fields sent were an unchanged / protected Address or Photo
      // (see above) — that is a successful no-op, not an error. Return the current record.
      if ("address" in data || "photo_url" in data || designationConflict || "designation_ids_prev" in data || "designation_id_prev" in data) {
        return NextResponse.json({ ok: true, no_change: true, contact: await resolveContactCard(id), ...(photoIgnored ? { photo_ignored: true } : {}), ...(addressConflict ? { address_conflict: true } : {}), ...(designationConflict ? { designation_conflict: true } : {}) });
      }
      return NextResponse.json({ message: "No fields to update" }, { status: 400 });
    }
    // Audit stamp: record WHEN this contact was last edited, so a persistence
    // question ("did my change stick?") can be answered from the row itself.
    // Feature-detected — absent on a deployment that hasn't added the column.
    if (existingColumns.has("updated_at")) sets.push("updated_at = NOW()");

    // Zone before the edit (Contact Page definition) — compared after, to keep the
    // callers' lists in step if this edit moves the contact to another Zone.
    const zoneBefore = await contactEffectiveZoneId(id);

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

    // A new/re-uploaded photo went in with this edit — mark it verified-available
    // (its bytes are in the durable store) so Photo Data / the count reflect it
    // immediately, and it is never treated as a dead reference.
    if (photoSet) {
      await ensurePhotoVerifiedColumn();
      await query("UPDATE contacts SET photo_verified = 1 WHERE id = ?", [id]).catch(() => {});
      if (oldPhotoForCleanup && oldPhotoForCleanup !== photoSet) await deleteLocalUpload(oldPhotoForCleanup);
    }

    // Sync the full designation set (add/remove keeps the rest; empty clears).
    if (designationIds !== null) await syncContactDesignations(id, designationIds);
    // Sync the selected Wings (Master-Data names). Present → full replace (add or
    // remove keeps the rest; empty array clears). Absent → wings left untouched.
    if ("wings" in data) await syncContactWings(id, data.wings);

    if (isAdminTier && "assigned_to_user_id" in data && data.assigned_to_user_id) {
      emitLiveEvent(LIVE_EVENTS.CONTACT_ASSIGNED, { count: 1, contact_id: id });
    }
    // Zone moved? Visibility itself is computed live from the contact's Zone (callers'
    // Zone lists update on the next request); an assignment to a caller of the OLD Zone
    // is released so it also leaves that caller's work queue.
    let releasedFrom = null;
    const zoneAfter = await contactEffectiveZoneId(id);
    if (String(zoneBefore ?? "") !== String(zoneAfter ?? "") && !(isAdminTier && data.assigned_to_user_id)) {
      releasedFrom = await releaseOutOfZoneAssignment(session, id, zoneAfter);
    }
    // Return the FULLY-RESOLVED record (all *_name display fields, assigned-to
    // username, resolved photo) — the exact shape the list renders — so the
    // client replaces its row with fresh data and never shows a stale name.
    updated = await resolveContactCard(id);
    return NextResponse.json({ ok: true, contact: updated, ...(releasedFrom ? { released_assignment: releasedFrom } : {}), ...(photoIgnored ? { photo_ignored: true } : {}), ...(addressConflict ? { address_conflict: true } : {}), ...(designationConflict ? { designation_conflict: true } : {}) });
  } catch (err) {
    console.error("contacts PUT error:", err);
    if (err?.code === "ER_DUP_ENTRY") return duplicatePhoneResponse();
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    // Admin role OR a "contacts" Page-Access grant — same Contacts-page capability.
    if (!(await pageAllowed(session, "contacts", session && isAdmin(session)))) {
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
