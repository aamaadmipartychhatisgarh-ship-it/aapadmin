import { parseIdList } from "@/lib/idList";
import { NextResponse } from "next/server";
import { sourceFilterClause, sourceSearchOr } from "@/lib/contactSource";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { isAdmin, scopeFilterSync } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { addedDateClause } from "@/lib/contactDateFilter";
import { buildContactPersonFilter } from "@/lib/contactFilter";
import { statusWhere } from "@/lib/contactStatus";
import { ACTIVE_STATUS_VALUES, normalizeActiveStatus } from "@/lib/activeStatus";
import { notWrongNumberClause, notNotInterestedClause, notPendingClause, ensureContactActiveStatusColumns, findRejectedContactByPhone, hasApprovalStatusColumn, ensureContactRemarksColumn } from "@/lib/contactExtras";
import { fetchContactExportRows, buildContactsWorkbookBuffer, buildContactsCsv, buildContactsPdfBuffer, contactsExportFilename } from "@/lib/contactExport";
import { contactWriteError } from "@/lib/contactWriteError";
import { phoneAlreadyRegistered, duplicatePhoneResponse } from "@/lib/contactDuplicate";
import { ensureContactDesignationsSchema, syncContactDesignations, parseDesignationIds, DESIGNATION_IDS_SQL, DESIGNATION_NAMES_SQL, DESIGNATION_PAIRS_SQL } from "@/lib/contactDesignations";
import { ensureContactWingsSchema, syncContactWings, WINGS_SQL } from "@/lib/contactWings";
import { prepareDesignationRows, applyRowWings } from "@/lib/contactDesignationRows";
import { ensureQualificationColumns, normalizeQualification } from "@/lib/contactQualification";
import { ensureVehicleColumn, normalizeVehicle } from "@/lib/contactVehicle";
import { buildContactOrderBy, CONTACT_DEFAULT_ORDER_BY } from "@/lib/contactSort";
import { repeatOffExclusion } from "@/lib/repeatOff";
import { callerZoneAccess, zoneContactClause } from "@/lib/callerZoneScope";
import { ensureRfaSchema, RFA_STATUS_SQL, rfaStatusFilterClause } from "@/lib/rfa";

// Cached feature-detect: does contacts.photo_verified exist yet? The Photo Update
// Count reflects RETRIEVABLE photos (not just a populated field) once recovery has
// verified them — but only where the column exists, so an un-migrated deployment
// keeps the old reference-based count with no error.
let photoVerifiedColPromise;
async function hasPhotoVerifiedCol() {
  if (!photoVerifiedColPromise) {
    photoVerifiedColPromise = query("SHOW COLUMNS FROM contacts LIKE 'photo_verified'")
      .then((r) => r.length > 0)
      .catch(() => false);
  }
  return photoVerifiedColPromise;
}

// The contacts list (and its photos) must never be served from a cache: it is
// per-user role/territory scoped and changes as contacts/photos are added, so a
// cached copy is exactly what made different users see different counts and the
// count appear to "shrink" over time. Force dynamic + no-store below.
export const dynamic = "force-dynamic";

// Columns the `contacts` table actually has in this deployment — detected once
// and cached, so the create path never references a column a given environment
// is missing (a past cause of intermittent 500s on save).
let contactColsPromise;
async function getContactColumns() {
  if (!contactColsPromise) {
    contactColsPromise = query(
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts'`
    ).then((rows) => new Set(rows.map((r) => r.name))).catch((e) => { contactColsPromise = undefined; throw e; });
  }
  return contactColsPromise;
}

// Parse a "1,2,3" style query value into a de-duped list of positive integers.
function idList(raw) {
  if (!raw) return [];
  return [...new Set(String(raw).split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0))];
}

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    // Contact managers (Admin / Supervisor / a "contacts" grant) — unchanged. A
    // CALLER with the Zone Contacts page reads the same list, but confined
    // server-side to their CURRENT Zone (callerZone below), read-only.
    const canManage = await pageAllowed(session, "contacts", session && isSupervisor(session));
    const callerZone = canManage ? null : await callerZoneAccess(session);
    if (!canManage && !callerZone) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    // The multi-designation join table must exist before the list query reads it.
    await ensureContactDesignationsSchema();
    await ensureContactWingsSchema();
    await ensureRfaSchema();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status"); // all | pending | done | assigned | pool
    const duplicates = searchParams.get("duplicates"); // "1" → only likely-duplicate contacts
    // "1" → only contacts whose latest call was a Wrong Number. That is the Wrong
    // Numbers module's own view — never available to a caller, whose list always
    // keeps the default visibility rules (wrong number / not interested / pending
    // approval / 10+ switched-off excluded).
    const wrong = callerZone ? null : searchParams.get("wrong");
    const zone_id = searchParams.get("zone_id");
    const lok_sabha_id = searchParams.get("lok_sabha_id");
    const district_id = searchParams.get("district_id");
    // assembly_id / designation_id accept a single value OR a comma-separated
    // list (assembly_ids / designation_ids) so several can be picked at once.
    const assembly_ids = idList(searchParams.get("assembly_ids") || searchParams.get("assembly_id"));
    const designation_ids = idList(searchParams.get("designation_ids") || searchParams.get("designation_id"));
    // Wings filter — a comma-separated list of stored wing names (from Master Data).
    // Resolved to their member designations in buildContactPersonFilter.
    const wings = (searchParams.get("wings") || "").split(",").map((w) => w.trim()).filter(Boolean);
    const assigned_to = searchParams.get("assigned_to");
    const search = searchParams.get("search");
    // Pagination — bounded so a huge table returns one page, not everything.
    const page = Math.max(1, parseInt(searchParams.get("page"), 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("page_size"), 10) || 50));
    const offset = (page - 1) * pageSize;
    // Server-side sort (over the COMPLETE filtered dataset, not just the page).
    // Null when no/invalid sort is asked for → the default order is kept. The
    // SAME order string is reused by the export so screen and file agree.
    const sortOrderBy = buildContactOrderBy(searchParams.get("sort"), searchParams.get("dir"));

    // Build the shared WHERE clause once (used for both the count and the list).
    let where = " WHERE 1=1";
    const params = [];
    const statusCond = statusWhere(status);
    if (statusCond) where += ` AND ${statusCond}`;
    // Wrong Number contacts live only in the dedicated Wrong Numbers module —
    // excluded from every other view of Contacts by default. The `wrong=1`
    // branch below is the one deliberate exception (it's what THAT module
    // itself queries), so skip the exclusion there.
    if (wrong !== "1") {
      where += await notWrongNumberClause("c");
      // Not-Interested contacts (Negative / Opponent / Not-a-Supporter sentiment)
      // live only on the Not Interested page — excluded from the main list.
      where += await notNotInterestedClause("c");
      // Contacts dispositioned Switched Off / Incoming Off more than 10 times drop
      // out of the main list (they live on the dedicated "10+ Times …" pages).
      where += await repeatOffExclusion("c");
      // Caller-created contacts awaiting (or refused in) Supervisor approval are not
      // live yet — they live only in the Pending Approval queue.
      where += await notPendingClause("c");
    }
    // Zone / Lok Sabha / District / Assembly / Designation — filter by the PERSON
    // (their linked worker) via the shared helper, so the same selection returns
    // the same people as the Add Workers page and the Distribution panel.
    const person = buildContactPersonFilter({ zone_id, lok_sabha_id, district_id, assembly_ids, designation_ids, wings });
    where += person.where;
    params.push(...person.params);
    // Caller filter: one id or a comma list = ANY of the selected callers (alternatives); ids are validated, and the
    // rows stay inside the user's own scope because every other condition / scope above still applies.
    { const ac = parseIdList(assigned_to); if (ac.invalid) return NextResponse.json({ message: "Invalid caller selection." }, { status: 400 }); if (ac.ids.length) { where += ` AND c.assigned_to_user_id IN (${ac.ids.map(() => "?").join(",")})`; params.push(...ac.ids); } }
    // Source filter (?source=unfiltered_calls): contacts that came from / were updated from Unfiltered Calls.
    { const sf = await sourceFilterClause(searchParams.get("source"), "c"); where += sf.where; params.push(...sf.params); }
    { const rf = await rfaStatusFilterClause(searchParams.get("rfa_status"), "c"); if (rf.error) return Response.json({ message: rf.error }, { status: 400 }); where += rf.where; params.push(...rf.params); }
    // Active Workers page: only workers with one of the four real statuses —
    // "Not Set" (NULL/blank) workers stay stored but are left out of the view.
    if (searchParams.get("worker_status_set") === "1") {
      if (await ensureContactActiveStatusColumns()) {
        where += ` AND c.active_status IN (${ACTIVE_STATUS_VALUES.map(() => "?").join(",")})`;
        params.push(...ACTIVE_STATUS_VALUES);
      } else where += " AND 1 = 0";
    }
    // One exact Worker Status (Active Workers card filter).
    const workerStatusOne = normalizeActiveStatus(searchParams.get("worker_status"));
    if (workerStatusOne) {
      if (await ensureContactActiveStatusColumns()) { where += " AND c.active_status = ?"; params.push(workerStatusOne); }
      else where += " AND 1 = 0";
    }
    if (search) {
      where += ` AND (c.person_name LIKE ? OR c.phone_number LIKE ?${await sourceSearchOr(search, "c")})`;
      params.push(`%${search}%`, `%${search}%`);
    }
    // Added-date filter (contacts.created_at; single date or range, IST calendar days).
    const addedDate = await addedDateClause(searchParams, "c");
    if (addedDate.error) return NextResponse.json({ message: addedDate.error }, { status: 400 });
    where += addedDate.sql; params.push(...addedDate.params);
    // Count-card filters (PROMPT 2): contacts with a real Address value, and
    // contacts that actually have a stored photo. Address = non-NULL and not
    // blank after trimming. Photo = a non-empty resolved photo_url (the same
    // COALESCE(contact, linked-worker) the list displays), so it reflects the
    // true stored/displayed photo state — never a blank/placeholder.
    if (searchParams.get("has_address") === "1") {
      where += " AND c.address IS NOT NULL AND TRIM(c.address) <> ''";
    }
    if (searchParams.get("has_photo") === "1") {
      // Count a photo only when it is actually retrievable. Once recovery has
      // verified rows: photo_verified = 1 counts, 0 (file genuinely missing) does
      // NOT, and rows not yet verified fall back to the reference test — so the
      // count starts equal to the old value and becomes exact after recovery, never
      // inflated by a dead reference (§5).
      const refCond = "COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) IS NOT NULL";
      where += (await hasPhotoVerifiedCol())
        ? ` AND (c.photo_verified = 1 OR (c.photo_verified IS NULL AND ${refCond}))`
        : ` AND ${refCond}`;
    }
    // Duplicates: phone_number is UNIQUE, so duplicates are the same number saved
    // in different formats (+91/0 prefix, spaces). Match on the last 10 digits.
    if (duplicates === "1") {
      where += ` AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.phone_number, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', ''), 10) IN (
        SELECT p FROM (
          SELECT RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone_number, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', ''), 10) AS p
            FROM contacts GROUP BY p HAVING COUNT(*) > 1
        ) dup_phones
      )`;
    }
    // Wrong numbers: contacts whose most recent call outcome was "Wrong Number"
    // AND whose current phone still matches the number that was called — so
    // once an admin corrects the number, the contact drops off this list and
    // returns to the normal calling list. Keep identical to the bulk-delete
    // endpoint.
    if (wrong === "1") {
      where += ` AND (
        SELECT csx.name FROM calls cx
          JOIN call_statuses csx ON csx.id = cx.status_id
         WHERE cx.contact_id = c.id
         ORDER BY cx.called_at DESC, cx.id DESC LIMIT 1
      ) = 'Wrong Number'
      AND (
        SELECT cx.phone_number FROM calls cx
         WHERE cx.contact_id = c.id
         ORDER BY cx.called_at DESC, cx.id DESC LIMIT 1
      ) = c.phone_number`;
    }
    // Geographic scope: the role's scope, or — for a caller — their current Zone.
    const scope = callerZone ? zoneContactClause(callerZone.zoneId, "c") : scopeFilterSync(session.user, "c");
    where += " " + scope.where;
    params.push(...scope.params);

    // Export — same filters + role scope as the on-screen list (this exact
    // `where`/`params`), just every matching row instead of one page. Both CSV
    // and Excel share the identical dataset + columns.
    const format = searchParams.get("format");
    // Exports stay a Contact-management feature (callers never had them).
    if (callerZone && format) {
      return NextResponse.json({ message: "Export is not available for your role." }, { status: 403 });
    }
    if (format === "csv" || format === "xlsx" || format === "pdf") {
      // Selected-contacts export (priority 1): when explicit ids are passed, they
      // OVERRIDE the filters — export EXACTLY those contacts, still confined to the
      // caller's role scope so ids outside their territory can't be exported. With
      // no ids, fall through to the on-screen filter/scope `where` (priority 2/3:
      // filtered, or all).
      const ids = idList(searchParams.get("ids"));
      let exWhere = where, exParams = params, selected = false;
      if (ids.length) {
        exWhere = ` WHERE c.id IN (${ids.map(() => "?").join(",")})${scope.where ? " " + scope.where : ""}`;
        exParams = [...ids, ...scope.params];
        selected = true;
      }
      // Column selection (optional): a comma list of column keys to include.
      // Absent → the full default column set (unchanged). Present → exactly those.
      const colsRaw = searchParams.get("columns");
      const cols = colsRaw != null ? colsRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;
      const rows = await fetchContactExportRows(exWhere, exParams, sortOrderBy);
      if (format === "csv") {
        return new NextResponse(buildContactsCsv(rows, cols), {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${contactsExportFilename(false, "csv")}"`,
            "Cache-Control": "no-store",
          },
        });
      }
      if (format === "pdf") {
        const buf = await buildContactsPdfBuffer(rows, `${rows.length} contact${rows.length === 1 ? "" : "s"} · ${selected ? "Selected" : "Filtered"} export · ${new Date().toLocaleString("en-GB")}`, cols);
        return new NextResponse(buf, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${contactsExportFilename(false, "pdf")}"`,
            "Cache-Control": "no-store",
          },
        });
      }
      const buf = await buildContactsWorkbookBuffer(rows, cols);
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${contactsExportFilename(false)}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // Always join the linked worker: person-aware filtering resolves through it,
    // AND the displayed designation must mirror Add Workers (the worker's full
    // multi-role `position` text), which the contact's single designation_id
    // often can't represent.
    const workerJoin = "LEFT JOIN workers w ON w.id = c.worker_id";

    // Total matching the current filters (not capped by the list limit).
    const countRows = await query(`SELECT COUNT(*) AS total FROM contacts c ${workerJoin} ${where}`, params);
    const total = Number(countRows[0]?.total || 0);

    // Caller-submitted contacts stay identifiable after approval: who submitted them.
    const submittedBySql = (await hasApprovalStatusColumn())
      ? "(SELECT u2.username FROM users u2 WHERE u2.id = c.created_by_user_id) AS submitted_by_name,"
      : "NULL AS submitted_by_name,";
    const contacts = await query(
      `SELECT c.*,
              u.username AS assigned_to_username,
              ld.name AS district_name,
              lw.name AS ward_name,
              -- Zone / Lok Sabha are shown from the contact's OWN column when set,
              -- otherwise derived from the district's hierarchy (district →
              -- lok_sabha → zone) since contacts are keyed by district_id.
              -- Assembly is the contact's own (shown as "—" when unset).
              COALESCE(cz.name, lz.name) AS zone_name,
              COALESCE(cls.name, lls.name) AS lok_sabha_name,
              la.name AS assembly_name,
              -- Designation display prefers the contact's OWN designation set
              -- (multi, PROMPT 5), then the worker's position, then the single
              -- legacy designation. designation_ids (CSV) preloads the edit form.
              COALESCE(${DESIGNATION_NAMES_SQL}, NULLIF(TRIM(w.position), ''), dsg.name) AS designation_name,
              ${DESIGNATION_IDS_SQL} AS designation_ids,
              ${DESIGNATION_PAIRS_SQL} AS designation_pairs,
              -- The contact's Wings (saved tags, Master-Data names) as a CSV, for
              -- the list display and to preload the edit form's Wings dropdown.
              ${WINGS_SQL} AS wings,
              ${RFA_STATUS_SQL} AS rfa_status,
              ${submittedBySql}
              -- Resolve the photo EXACTLY like the has_photo count condition:
              -- NULLIF(TRIM(...)) so an empty-string c.photo_url falls back to the
              -- linked worker photo. A plain COALESCE returned '' for such rows, so
              -- a contact counted via its worker photo showed BLANK in the Photo
              -- Update Count list — the count/list photo mismatch. Now identical.
              COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) AS photo_url
         FROM contacts c
         ${workerJoin}
         LEFT JOIN users u ON u.id = c.assigned_to_user_id
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations lls ON lls.id = ld.parent_id
         LEFT JOIN locations lz ON lz.id = lls.parent_id
         LEFT JOIN locations cz ON cz.id = c.zone_id
         LEFT JOIN locations cls ON cls.id = c.lok_sabha_id
         LEFT JOIN locations la ON la.id = c.assembly_id
         LEFT JOIN locations lw ON lw.id = c.ward_id
         LEFT JOIN designations dsg ON dsg.id = c.designation_id
         ${where}
        ORDER BY ${sortOrderBy
          ? sortOrderBy
          : duplicates === "1"
            ? "RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.phone_number, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', ''), 10) ASC, c.id ASC"
            : CONTACT_DEFAULT_ORDER_BY}
        LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    // Full pagination metadata so the client can page through the COMPLETE set
    // (every record is reachable across pages — nothing is silently dropped by a
    // cap). no-store so all authorized users always get the same fresh list.
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    // A caller's list carries the Zone it is confined to (read fresh), so the page
    // can show it and offer only that Zone's Lok Sabha / District / Assembly options.
    let caller_zone;
    if (callerZone) {
      const [z] = callerZone.zoneId ? await query("SELECT id, name FROM locations WHERE id = ?", [callerZone.zoneId]) : [];
      caller_zone = { zone_id: callerZone.zoneId, zone_name: z?.name || null };
    }
    return NextResponse.json(
      { contacts, total, page, page_size: pageSize,
        pagination: { page, pageSize, total, totalPages }, caller_zone },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    console.error("contacts GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "contacts", session && isAdmin(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const data = await req.json().catch(() => ({}));
    const { person_name, phone_number, address, designation_id, zone_id, lok_sabha_id, district_id, assembly_id, ward_id, booth_id, assigned_to_user_id, photo_url } = data;
    if (!person_name?.trim() || !phone_number?.trim()) {
      return NextResponse.json({ message: "Name and mobile number are required." }, { status: 400 });
    }
    const qual = normalizeQualification(data);
    if (qual.error) return NextResponse.json({ message: qual.error }, { status: 400 });
    await ensureQualificationColumns();
    const veh = normalizeVehicle(data);
    if (veh.error) return NextResponse.json({ message: veh.error }, { status: 400 });
    await ensureVehicleColumn();
    // Multi-designation (PROMPT 5): accept designation_ids[]; the legacy single
    // designation_id is treated as one entry. The primary column keeps the FIRST
    // (or null when none) — no default is ever assigned.
    // Combined Designation + Wing rows (Add Contact): validated against Master Data and turned into the
    // designation set / wing set below; each designation is then saved paired with its Wing.
    const rowsRes = await prepareDesignationRows(data);
    if (rowsRes.error) return NextResponse.json({ message: rowsRes.error }, { status: 400 });
    const designationIds = parseDesignationIds(data.designation_ids ?? (designation_id ? [designation_id] : []));
    const primaryDesignation = designationIds[0] || null;
    // Reject a duplicate mobile up front with a clear message (the uniq_phone
    // index is the race-safe backstop, surfaced via contactWriteError below).
    if (await phoneAlreadyRegistered(phone_number)) return duplicatePhoneResponse();
    // Only ever write columns this deployment's schema actually has — a hardcoded
    // column that a given environment lacks was a source of intermittent 500s.
    const existing = await getContactColumns();
    // The Remarks column may not exist yet on this deployment: create it so a Remark is never silently dropped.
    const wantsRemarks = typeof data.remarks === "string" && data.remarks.trim() !== "";
    if (await ensureContactRemarksColumn()) existing.add("remarks");
    else if (wantsRemarks) return NextResponse.json({ message: "The Remark could not be saved because the Remarks column is unavailable on this database. Nothing was changed." }, { status: 500 });
    const desired = {
      person_name: person_name.trim(),
      phone_number: phone_number.trim(),
      address: address || null,
      // Remarks / Notes entered in Add Contact: saved exactly as typed (blank = none).
      ...(typeof data.remarks === "string" && data.remarks.trim() ? { remarks: data.remarks.slice(0, 5000) } : {}),
      designation_id: primaryDesignation,
      // Full location hierarchy (Zone → Lok Sabha → District → Assembly → Block).
      zone_id: zone_id || null,
      lok_sabha_id: lok_sabha_id || null,
      district_id: district_id || null,
      assembly_id: assembly_id || null,
      ward_id: ward_id || null,
      booth_id: booth_id || null,
      photo_url: photo_url || null,
      assigned_to_user_id: assigned_to_user_id || null,
      ...(qual.present ? { qualification: qual.qualification, education_level: qual.education_level } : {}),
      ...(veh.present ? { vehicle: veh.vehicle } : {}),
    };
    const cols = [];
    const vals = [];
    for (const [k, v] of Object.entries(desired)) if (existing.has(k)) { cols.push(k); vals.push(v); }
    // Assignment metadata (who/when) when created already assigned to a caller.
    if (assigned_to_user_id) {
      if (existing.has("assigned_at")) { cols.push("assigned_at"); vals.push(new Date()); }
      if (existing.has("assigned_by_user_id")) { cols.push("assigned_by_user_id"); vals.push(session.user.id); }
    }
    // A REJECTED caller submission for this number is not live, so an admin may add
    // the contact: the rejected row is revived in place as a live contact (same id —
    // never two rows for one number). Otherwise insert as before.
    const rejectedId = await findRejectedContactByPhone(desired.phone_number);
    let newId;
    if (rejectedId) {
      const live = ["approval_status", "created_by_user_id", "reviewed_by_user_id", "reviewed_at", "rejection_reason", "locked_by_user_id", "locked_at"].filter((c) => existing.has(c));
      await query(
        `UPDATE contacts SET ${[...cols.map((c) => `${c} = ?`), ...live.map((c) => `${c} = NULL`), ...(existing.has("is_completed") ? ["is_completed = 0"] : [])].join(", ")} WHERE id = ?`,
        [...vals, rejectedId]
      );
      newId = rejectedId;
    } else {
      const res = await query(
        `INSERT INTO contacts (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
        vals
      );
      newId = res.insertId;
    }
    // Save the full designation set against the new contact.
    await syncContactDesignations(newId, designationIds);
    // Save the selected Wings (Master-Data names) against the new contact.
    await syncContactWings(newId, data.wings);
    await applyRowWings(newId, rowsRes.rows);
    return NextResponse.json({ id: newId }, { status: 201 });
  } catch (err) {
    return contactWriteError(err, "contacts POST");
  }
}
