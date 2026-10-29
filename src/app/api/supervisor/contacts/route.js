import { parseIdList } from "@/lib/idList";
import { NextResponse } from "next/server";
import { sourceFilterClause, sourceSearchOr } from "@/lib/contactSource";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSupervisorRole, normalizeRole, ROLES } from "@/lib/permissions";
import { query } from "@/lib/db";
import { ensureQualificationColumns, normalizeQualification } from "@/lib/contactQualification";
import { ensureVehicleColumn, normalizeVehicle } from "@/lib/contactVehicle";
import { addedDateClause } from "@/lib/contactDateFilter";
import { logAudit } from "@/lib/audit";
import { buildContactPersonFilter } from "@/lib/contactFilter";
import { statusWhere } from "@/lib/contactStatus";
import { notWrongNumberClause, notNotInterestedClause, notPendingClause } from "@/lib/contactExtras";
import { supervisorScopeFilter, supervisorCallerScopeFilter, supervisorTerritory } from "@/lib/supervisorScope";
import { ensureRfaSchema, RFA_STATUS_SQL } from "@/lib/rfa";
import { fetchContactExportRows, buildContactsWorkbookBuffer, buildContactsCsv, buildContactsPdfBuffer, contactsExportFilename } from "@/lib/contactExport";
import { contactWriteError } from "@/lib/contactWriteError";
import { phoneAlreadyRegistered, duplicatePhoneResponse } from "@/lib/contactDuplicate";
import { ensureContactDesignationsSchema, syncContactDesignations, parseDesignationIds, DESIGNATION_IDS_SQL, DESIGNATION_NAMES_SQL, DESIGNATION_PAIRS_SQL } from "@/lib/contactDesignations";
import { ensureContactWingsSchema, syncContactWings, WINGS_SQL } from "@/lib/contactWings";
import { prepareDesignationRows, applyRowWings } from "@/lib/contactDesignationRows";
import { buildContactOrderBy, CONTACT_DEFAULT_ORDER_BY } from "@/lib/contactSort";
import { repeatOffExclusion } from "@/lib/repeatOff";

// Never cache the (territory-scoped) supervisor contacts list — a cached copy is
// what made counts differ between users / shrink over time.
export const dynamic = "force-dynamic";

// Supervisor-scoped mirror of GET /api/contacts (src/app/api/contacts/route.js)
// — same filters, same shape, same pagination — but gated to the strict
// Supervisor role and ALWAYS scoped to the supervisor's own territory via
// supervisorScopeFilter (never bypassable, unlike scopeFilterSync's
// "supervisor sees everything" default used by the admin route).
function idList(raw) {
  if (!raw) return [];
  return [...new Set(String(raw).split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0))];
}

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisorRole(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    await ensureContactDesignationsSchema();
    await ensureContactWingsSchema();
    await ensureRfaSchema();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const duplicates = searchParams.get("duplicates");
    const wrong = searchParams.get("wrong");
    const zone_id = searchParams.get("zone_id");
    const lok_sabha_id = searchParams.get("lok_sabha_id");
    const district_id = searchParams.get("district_id");
    const assembly_ids = idList(searchParams.get("assembly_ids") || searchParams.get("assembly_id"));
    const designation_ids = idList(searchParams.get("designation_ids") || searchParams.get("designation_id"));
    const wings = (searchParams.get("wings") || "").split(",").map((w) => w.trim()).filter(Boolean);
    const assigned_to = searchParams.get("assigned_to");
    const search = searchParams.get("search");
    const page = Math.max(1, parseInt(searchParams.get("page"), 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("page_size"), 10) || 50));
    const offset = (page - 1) * pageSize;
    // Server-side sort shared with the list + export (see admin route).
    const sortOrderBy = buildContactOrderBy(searchParams.get("sort"), searchParams.get("dir"));

    let where = " WHERE 1=1";
    const params = [];
    const statusCond = statusWhere(status);
    if (statusCond) where += ` AND ${statusCond}`;
    if (wrong !== "1") {
      where += await notWrongNumberClause("c");
    where += await notNotInterestedClause("c");
      where += await repeatOffExclusion("c");
      where += await notPendingClause("c");
    }
    const person = buildContactPersonFilter({ zone_id, lok_sabha_id, district_id, assembly_ids, designation_ids, wings });
    where += person.where;
    params.push(...person.params);
    // Caller filter: one id or a comma list = ANY of the selected callers (alternatives); ids are validated, and the
    // rows stay inside the user's own scope because every other condition / scope above still applies.
    { const ac = parseIdList(assigned_to); if (ac.invalid) return NextResponse.json({ message: "Invalid caller selection." }, { status: 400 }); if (ac.ids.length) { where += ` AND c.assigned_to_user_id IN (${ac.ids.map(() => "?").join(",")})`; params.push(...ac.ids); } }
    // Source filter (?source=unfiltered_calls): contacts that came from / were updated from Unfiltered Calls.
    { const sf = await sourceFilterClause(searchParams.get("source"), "c"); where += sf.where; params.push(...sf.params); }
    if (search) {
      where += ` AND (c.person_name LIKE ? OR c.phone_number LIKE ?${await sourceSearchOr(search, "c")})`;
      params.push(`%${search}%`, `%${search}%`);
    }
    // Added-date filter (contacts.created_at; single date or range, IST calendar days).
    const addedDate = await addedDateClause(searchParams, "c");
    if (addedDate.error) return NextResponse.json({ message: addedDate.error }, { status: 400 });
    where += addedDate.sql; params.push(...addedDate.params);
    // Address / Photo count-card filters (PROMPT 2) — mirror of the admin route.
    if (searchParams.get("has_address") === "1") {
      where += " AND c.address IS NOT NULL AND TRIM(c.address) <> ''";
    }
    if (searchParams.get("has_photo") === "1") {
      where += " AND COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) IS NOT NULL";
    }
    if (duplicates === "1") {
      where += ` AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.phone_number, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', ''), 10) IN (
        SELECT p FROM (
          SELECT RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone_number, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', ''), 10) AS p
            FROM contacts GROUP BY p HAVING COUNT(*) > 1
        ) dup_phones
      )`;
    }
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
    // Strict, non-bypassable territory scope — the whole point of this route.
    const scope = supervisorScopeFilter(session.user, "c");
    where += " " + scope.where;
    params.push(...scope.params);

    // Export — same filters AND the supervisor's territory scope (already in
    // `where`), every matching row. Same code path as the list, so what the
    // supervisor downloads is exactly what they can see. CSV + Excel share the
    // identical dataset + columns.
    const format = searchParams.get("format");
    if (format === "csv" || format === "xlsx" || format === "pdf") {
      // Selected-contacts export (priority 1) overrides the filters, but ALWAYS
      // inside the supervisor's non-bypassable territory scope — ids outside it
      // are dropped. No ids → the on-screen filtered/scoped set.
      const ids = idList(searchParams.get("ids"));
      let exWhere = where, exParams = params, selected = false;
      if (ids.length) {
        exWhere = ` WHERE c.id IN (${ids.map(() => "?").join(",")}) ${scope.where}`;
        exParams = [...ids, ...scope.params];
        selected = true;
      }
      const colsRaw = searchParams.get("columns");
      const cols = colsRaw != null ? colsRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;
      const rows = await fetchContactExportRows(exWhere, exParams, sortOrderBy);
      if (format === "csv") {
        return new NextResponse(buildContactsCsv(rows, cols), {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${contactsExportFilename(true, "csv")}"`,
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
            "Content-Disposition": `attachment; filename="${contactsExportFilename(true, "pdf")}"`,
            "Cache-Control": "no-store",
          },
        });
      }
      const buf = await buildContactsWorkbookBuffer(rows, cols);
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${contactsExportFilename(true)}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const workerJoin = "LEFT JOIN workers w ON w.id = c.worker_id";

    const countRows = await query(`SELECT COUNT(*) AS total FROM contacts c ${workerJoin} ${where}`, params);
    const total = Number(countRows[0]?.total || 0);

    const contacts = await query(
      `SELECT c.*,
              u.username AS assigned_to_username,
              ld.name AS district_name,
              lw.name AS ward_name,
              -- Same geography derivation as the admin route (district → lok_sabha
              -- → zone), with the contact's own zone/lok_sabha winning when set.
              COALESCE(cz.name, lz.name) AS zone_name,
              COALESCE(cls.name, lls.name) AS lok_sabha_name,
              la.name AS assembly_name,
              COALESCE(${DESIGNATION_NAMES_SQL}, NULLIF(TRIM(w.position), ''), dsg.name) AS designation_name,
              ${DESIGNATION_IDS_SQL} AS designation_ids,
              ${DESIGNATION_PAIRS_SQL} AS designation_pairs,
              ${WINGS_SQL} AS wings,
              ${RFA_STATUS_SQL} AS rfa_status,
              -- Resolve the photo EXACTLY like the has_photo count condition
              -- (NULLIF(TRIM(...))), so an empty-string c.photo_url falls back to
              -- the worker photo instead of returning '' — otherwise a contact
              -- counted via its worker photo would show blank in the list.
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
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return NextResponse.json(
      { contacts, total, page, page_size: pageSize,
        pagination: { page, pageSize, total, totalPages } },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    console.error("supervisor contacts GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// Which of the geo columns actually exist on `contacts` in this deployment
// (schemas have drifted across environments — same defensive detection the
// admin route and the [id] route use).
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

// POST /api/supervisor/contacts — supervisor-scoped mirror of POST
// /api/contacts (Add Contact). Identical workflow to the admin's, with one
// server-enforced difference: the new contact's geography is stamped from the
// supervisor's OWN territory, never from arbitrary client input, so a created
// contact ALWAYS lands inside the supervisor's scope (and can never be planted
// outside it). An optional initial caller assignment is validated to be a
// caller within the supervisor's territory, exactly like the [id] PUT.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisorRole(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    // territory is null for an unconfigured (full-oversight) supervisor — they
    // add contacts like an admin (free district choice), not locked to an anchor.
    const territory = await supervisorTerritory(session.user, query);

    const data = await req.json().catch(() => ({}));
    const { person_name, phone_number, address, designation_id, assigned_to_user_id, photo_url } = data;
    if (!person_name?.trim() || !phone_number?.trim()) {
      return NextResponse.json({ message: "Name and mobile number are required." }, { status: 400 });
    }
    // Combined Designation + Wing rows (Add Contact): validated against Master Data and turned into the
    // designation set / wing set below; each designation is then saved paired with its Wing.
    const rowsRes = await prepareDesignationRows(data);
    if (rowsRes.error) return NextResponse.json({ message: rowsRes.error }, { status: 400 });
    const designationIds = parseDesignationIds(data.designation_ids ?? (designation_id ? [designation_id] : []));
    // Reject a duplicate mobile up front with a clear message (the uniq_phone
    // index is the race-safe backstop, surfaced via contactWriteError below).
    if (await phoneAlreadyRegistered(phone_number)) return duplicatePhoneResponse();

    // An initial assignment (optional) must be to a caller this supervisor may
    // assign to (their territory, or any caller when unconfigured).
    if (assigned_to_user_id) {
      const callerScope = supervisorCallerScopeFilter(session.user, "u");
      const rows = await query(
        `SELECT id, role FROM users u WHERE u.id = ? ${callerScope.where}`,
        [assigned_to_user_id, ...callerScope.params]
      );
      const target = rows[0];
      if (!target || normalizeRole(target.role) !== ROLES.CALLER) {
        return NextResponse.json({ message: "That caller is not in your territory." }, { status: 403 });
      }
    }

    // Geography is dictated by the supervisor's anchor (assembly > district >
    // zone), NOT by arbitrary client input, so a new contact always lands in
    // scope. Contacts are keyed by district_id (see supervisorScopeFilter), so
    // every stamped contact must carry a district_id within the supervisor's
    // reach — otherwise it would be invisible in their own (district-scoped) list.
    const geo = {};
    if (territory) {
      if (territory.zone) geo.zone_id = territory.zone.id;
      if (territory.lok_sabha) geo.lok_sabha_id = territory.lok_sabha.id;
      if (territory.district) geo.district_id = territory.district.id;
      if (territory.assembly) geo.assembly_id = territory.assembly.id;
      // A zone-level supervisor has no fixed district, so they MUST pick one —
      // and only a district that belongs to their zone.
      if (territory.level === "zone") {
        const rows = data.district_id ? await query(
          `SELECT d.id, ls.id AS lok_sabha_id
             FROM locations d
             JOIN locations ls ON ls.id = d.parent_id AND ls.type = 'lok_sabha'
            WHERE d.id = ? AND ls.parent_id = ?`,
          [data.district_id, territory.zone.id]
        ) : [];
        if (!rows[0]) {
          return NextResponse.json({ message: "Pick a district within your zone for this contact." }, { status: 400 });
        }
        geo.district_id = rows[0].id;
        geo.lok_sabha_id = rows[0].lok_sabha_id;
      }
    } else if (data.district_id) {
      // Unconfigured supervisor (full oversight): honor the chosen district.
      geo.district_id = data.district_id;
    }

    // Assembly + Block (ward) can be chosen within the supervisor's district.
    // Validate the parentage so an out-of-territory id can't be injected: the
    // assembly must belong to the stamped district, the block to that assembly.
    // (An assembly-anchored supervisor already has geo.assembly_id fixed above.)
    if (!geo.assembly_id && data.assembly_id && geo.district_id) {
      const rows = await query(
        "SELECT id FROM locations WHERE id = ? AND parent_id = ? AND type = 'assembly'",
        [data.assembly_id, geo.district_id]
      );
      if (!rows[0]) return NextResponse.json({ message: "Selected assembly is not in your district." }, { status: 400 });
      geo.assembly_id = rows[0].id;
    }
    if (data.ward_id && geo.assembly_id) {
      const rows = await query("SELECT id FROM locations WHERE id = ? AND parent_id = ?", [data.ward_id, geo.assembly_id]);
      if (!rows[0]) return NextResponse.json({ message: "Selected block is not in your assembly." }, { status: 400 });
      geo.ward_id = rows[0].id;
    }

    const qual = normalizeQualification(data);
    if (qual.error) return NextResponse.json({ message: qual.error }, { status: 400 });
    await ensureQualificationColumns();
    const veh = normalizeVehicle(data);
    if (veh.error) return NextResponse.json({ message: veh.error }, { status: 400 });
    await ensureVehicleColumn();
    const existingColumns = await getContactColumns();
    const cols = [];
    const vals = [];
    const add = (col, val) => { if (existingColumns.has(col)) { cols.push(col); vals.push(val); } };
    if (qual.present) { add("qualification", qual.qualification); add("education_level", qual.education_level); }
    if (veh.present) add("vehicle", veh.vehicle);
    add("person_name", person_name.trim());
    add("phone_number", phone_number.trim());
    add("address", address || null);
    // Remarks / Notes entered in Add Contact: saved exactly as typed (blank = none).
    if (typeof data.remarks === "string" && data.remarks.trim()) add("remarks", data.remarks.slice(0, 5000));
    add("designation_id", designationIds[0] || null); // primary = first (multi below)
    add("photo_url", photo_url || null);
    for (const [col, val] of Object.entries(geo)) add(col, val);
    add("assigned_to_user_id", assigned_to_user_id || null);
    if (assigned_to_user_id) {
      if (existingColumns.has("assigned_at")) add("assigned_at", new Date());
      if (existingColumns.has("assigned_by_user_id")) add("assigned_by_user_id", session.user.id);
    }

    const res = await query(
      `INSERT INTO contacts (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      vals
    );
    await syncContactDesignations(res.insertId, designationIds);
    await syncContactWings(res.insertId, data.wings);
    await applyRowWings(res.insertId, rowsRes.rows);
    await logAudit(session, { action: "contact.create", entityType: "contact", entityId: res.insertId, details: { supervisor: true, territory: territory?.level || null } });
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    return contactWriteError(err, "supervisor contacts POST");
  }
}
