import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { isAdmin, scopeFilterSync } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { buildContactPersonFilter } from "@/lib/contactFilter";
import { statusWhere } from "@/lib/contactStatus";
import { notWrongNumberClause } from "@/lib/contactExtras";
import { fetchContactExportRows, buildContactsWorkbookBuffer, buildContactsCsv, buildContactsPdfBuffer, contactsExportFilename } from "@/lib/contactExport";
import { contactWriteError } from "@/lib/contactWriteError";
import { phoneAlreadyRegistered, duplicatePhoneResponse } from "@/lib/contactDuplicate";
import { ensureContactDesignationsSchema, syncContactDesignations, parseDesignationIds, DESIGNATION_IDS_SQL, DESIGNATION_NAMES_SQL } from "@/lib/contactDesignations";

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
    if (!(await pageAllowed(session, "contacts", session && isSupervisor(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    // The multi-designation join table must exist before the list query reads it.
    await ensureContactDesignationsSchema();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status"); // all | pending | done | assigned | pool
    const duplicates = searchParams.get("duplicates"); // "1" → only likely-duplicate contacts
    const wrong = searchParams.get("wrong"); // "1" → only contacts whose latest call was a Wrong Number
    const zone_id = searchParams.get("zone_id");
    const lok_sabha_id = searchParams.get("lok_sabha_id");
    const district_id = searchParams.get("district_id");
    // assembly_id / designation_id accept a single value OR a comma-separated
    // list (assembly_ids / designation_ids) so several can be picked at once.
    const assembly_ids = idList(searchParams.get("assembly_ids") || searchParams.get("assembly_id"));
    const designation_ids = idList(searchParams.get("designation_ids") || searchParams.get("designation_id"));
    const assigned_to = searchParams.get("assigned_to");
    const search = searchParams.get("search");
    // Pagination — bounded so a huge table returns one page, not everything.
    const page = Math.max(1, parseInt(searchParams.get("page"), 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("page_size"), 10) || 50));
    const offset = (page - 1) * pageSize;

    // Build the shared WHERE clause once (used for both the count and the list).
    let where = " WHERE 1=1";
    const params = [];
    const statusCond = statusWhere(status);
    if (statusCond) where += ` AND ${statusCond}`;
    // Wrong Number contacts live only in the dedicated Wrong Numbers module —
    // excluded from every other view of Contacts by default. The `wrong=1`
    // branch below is the one deliberate exception (it's what THAT module
    // itself queries), so skip the exclusion there.
    if (wrong !== "1") where += await notWrongNumberClause("c");
    // Zone / Lok Sabha / District / Assembly / Designation — filter by the PERSON
    // (their linked worker) via the shared helper, so the same selection returns
    // the same people as the Add Workers page and the Distribution panel.
    const person = buildContactPersonFilter({ zone_id, lok_sabha_id, district_id, assembly_ids, designation_ids });
    where += person.where;
    params.push(...person.params);
    if (assigned_to) { where += " AND c.assigned_to_user_id = ?"; params.push(assigned_to); }
    if (search) {
      where += " AND (c.person_name LIKE ? OR c.phone_number LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }
    // Count-card filters (PROMPT 2): contacts with a real Address value, and
    // contacts that actually have a stored photo. Address = non-NULL and not
    // blank after trimming. Photo = a non-empty resolved photo_url (the same
    // COALESCE(contact, linked-worker) the list displays), so it reflects the
    // true stored/displayed photo state — never a blank/placeholder.
    if (searchParams.get("has_address") === "1") {
      where += " AND c.address IS NOT NULL AND TRIM(c.address) <> ''";
    }
    if (searchParams.get("has_photo") === "1") {
      where += " AND COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) IS NOT NULL";
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
    // Geographic scope from role
    const scope = scopeFilterSync(session.user, "c");
    where += " " + scope.where;
    params.push(...scope.params);

    // Export — same filters + role scope as the on-screen list (this exact
    // `where`/`params`), just every matching row instead of one page. Both CSV
    // and Excel share the identical dataset + columns.
    const format = searchParams.get("format");
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
      const rows = await fetchContactExportRows(exWhere, exParams);
      if (format === "csv") {
        return new NextResponse(buildContactsCsv(rows), {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${contactsExportFilename(false, "csv")}"`,
            "Cache-Control": "no-store",
          },
        });
      }
      if (format === "pdf") {
        const buf = await buildContactsPdfBuffer(rows, `${rows.length} contact${rows.length === 1 ? "" : "s"} · ${selected ? "Selected" : "Filtered"} export · ${new Date().toLocaleString("en-GB")}`);
        return new NextResponse(buf, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${contactsExportFilename(false, "pdf")}"`,
            "Cache-Control": "no-store",
          },
        });
      }
      const buf = await buildContactsWorkbookBuffer(rows);
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
              -- Contacts have their own native photo_url now; COALESCE only
              -- covers rows from before that column existed whose backfill
              -- (scripts/add-contact-photo-url.mjs) somehow missed them.
              COALESCE(c.photo_url, w.photo_url) AS photo_url
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
        ORDER BY ${duplicates === "1"
          ? "RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.phone_number, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', ''), 10) ASC, c.id ASC"
          : "c.is_completed ASC, c.id DESC"}
        LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    // Full pagination metadata so the client can page through the COMPLETE set
    // (every record is reachable across pages — nothing is silently dropped by a
    // cap). no-store so all authorized users always get the same fresh list.
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return NextResponse.json(
      { contacts, total, page, page_size: pageSize,
        pagination: { page, pageSize, total, totalPages } },
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
    // Multi-designation (PROMPT 5): accept designation_ids[]; the legacy single
    // designation_id is treated as one entry. The primary column keeps the FIRST
    // (or null when none) — no default is ever assigned.
    const designationIds = parseDesignationIds(data.designation_ids ?? (designation_id ? [designation_id] : []));
    const primaryDesignation = designationIds[0] || null;
    // Reject a duplicate mobile up front with a clear message (the uniq_phone
    // index is the race-safe backstop, surfaced via contactWriteError below).
    if (await phoneAlreadyRegistered(phone_number)) return duplicatePhoneResponse();
    // Only ever write columns this deployment's schema actually has — a hardcoded
    // column that a given environment lacks was a source of intermittent 500s.
    const existing = await getContactColumns();
    const desired = {
      person_name: person_name.trim(),
      phone_number: phone_number.trim(),
      address: address || null,
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
    };
    const cols = [];
    const vals = [];
    for (const [k, v] of Object.entries(desired)) if (existing.has(k)) { cols.push(k); vals.push(v); }
    // Assignment metadata (who/when) when created already assigned to a caller.
    if (assigned_to_user_id) {
      if (existing.has("assigned_at")) { cols.push("assigned_at"); vals.push(new Date()); }
      if (existing.has("assigned_by_user_id")) { cols.push("assigned_by_user_id"); vals.push(session.user.id); }
    }
    const res = await query(
      `INSERT INTO contacts (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      vals
    );
    // Save the full designation set against the new contact.
    await syncContactDesignations(res.insertId, designationIds);
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    return contactWriteError(err, "contacts POST");
  }
}
