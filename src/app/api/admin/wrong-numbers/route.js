import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isCaller, scopeFilterSync } from "@/lib/permissions";
import { resolveActingUserId } from "@/lib/actAs";
import { ensureUnfilteredCallLogSchema } from "@/lib/unfilteredContacts";
import { sourceSelectSql, wrongNumberSourceFilter, sourceSearchOr } from "@/lib/contactSource";
import { contactSourceLabel } from "@/lib/sourceLabel";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { hasWrongNumberColumn, hasWrongNumberDetailColumns } from "@/lib/contactExtras";

export const dynamic = "force-dynamic";

// GET /api/admin/wrong-numbers — the dedicated Wrong Numbers module list.
// Supervisor / Team Leader / Super Admin (+ scoped admins) only.
// Filters: search, zone_id, lok_sabha_id, district_id, assembly_id, caller,
// date_from/date_to (on the date the number was marked wrong), status.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "wrong_numbers", session && (isOversight(session) || isCaller(session))))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const callerOnly = !isOversight(session);
    // A Caller sees ONLY the Unfiltered Calls they marked Wrong Number (their own records); the contact list stays oversight-only.
    let callerId = null;
    if (callerOnly) callerId = (await resolveActingUserId(session)).userId;
    if (!callerOnly && !(await hasWrongNumberColumn())) {
      return NextResponse.json({ wrong_numbers: [] });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search");
    const zoneId = searchParams.get("zone_id");
    const lokSabhaId = searchParams.get("lok_sabha_id");
    const districtId = searchParams.get("district_id");
    const assemblyId = searchParams.get("assembly_id");
    const caller = searchParams.get("caller");
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");
    const statusF = searchParams.get("status"); // assigned | unassigned
    const reason = searchParams.get("reason");
    const designationId = searchParams.get("designation_id");
    const sourceF = searchParams.get("source"); // unfiltered_calls | registration | none (Not Available)

    const where = ["c.is_wrong_number = 1"];
    const params = [];
    if (search) { where.push(`(c.person_name LIKE ? OR c.phone_number LIKE ?${await sourceSearchOr(search, "c")})`); params.push(`%${search}%`, `%${search}%`); }
    { const sf = await wrongNumberSourceFilter(sourceF, "c"); if (sf) where.push(sf); }
    // Zone / Lok Sabha filters use the Contact Page definition (own value, else the district's).
    if (zoneId) { where.push("(c.zone_id = ? OR (c.zone_id IS NULL AND dz.id = ?))"); params.push(zoneId, zoneId); }
    if (lokSabhaId) { where.push("(c.lok_sabha_id = ? OR (c.lok_sabha_id IS NULL AND dls.id = ?))"); params.push(lokSabhaId, lokSabhaId); }
    if (districtId) { where.push("c.district_id = ?"); params.push(districtId); }
    if (assemblyId) { where.push("c.assembly_id = ?"); params.push(assemblyId); }
    if (caller) { where.push("c.assigned_to_user_id = ?"); params.push(caller); }
    if (statusF === "assigned") where.push("c.assigned_to_user_id IS NOT NULL");
    if (statusF === "unassigned") where.push("c.assigned_to_user_id IS NULL");
    if (reason) { where.push("c.wrong_number_reason = ?"); params.push(reason); }
    if (designationId) { where.push("c.designation_id = ?"); params.push(designationId); }

    // Geographic scope from role (super_admin / state / supervisor see all).
    // A Caller sees only THEIR OWN assigned contacts here (read-only page); everyone else keeps the role scope.
    let scope = { where: "", params: [] };
    if (callerOnly) { where.push("c.assigned_to_user_id = ?"); params.push(callerId); }
    else { scope = scopeFilterSync(session.user, "c"); if (scope.where) { where.push(scope.where.replace(/^AND /, "")); params.push(...scope.params); } }

    // Date range applies to when the contact was marked a wrong number. Applied
    // on the derived column via an outer WHERE (a wrapper subquery) so it stays a
    // simple row filter.
    const outer = [];
    const outerParams = [];
    if (dateFrom) { outer.push("DATE(t.marked_wrong_date) >= ?"); outerParams.push(dateFrom); }
    if (dateTo) { outer.push("DATE(t.marked_wrong_date) <= ?"); outerParams.push(dateTo); }
    const outerWhere = outer.length ? `WHERE ${outer.join(" AND ")}` : "";

    const hasDetail = await hasWrongNumberDetailColumns();
    const detailCols = hasDetail
      ? `c.wrong_number_reason, c.wrong_number_notes, c.wrong_number_at,
         mb.username AS marked_by_name, c.restored_at, rb.username AS restored_by_name,`
      : "";
    const detailJoins = hasDetail
      ? `LEFT JOIN users mb ON mb.id = c.wrong_number_by
         LEFT JOIN users rb ON rb.id = c.restored_by`
      : "";

    // Unfiltered Calls marked Wrong Number: the same page lists them (read from unfiltered_contacts - no Contact is created
    // for them), with the saved reason. Global-scope users (Super Admin / State Admin / Supervisor, whose scope adds no
    // geographic condition) see all of them; a Caller sees their own.
    let unfRows = [];
    if (callerOnly || !scope.where) {
      await ensureUnfilteredCallLogSchema();
      const uw = ["(u.call_status_name = 'Wrong Number' OR (u.call_status_name = 'Phone Picked' AND u.call_sentiment = 'wrong_number'))", "u.completed_at IS NOT NULL"], up = [];
      if (callerOnly) { uw.push("u.assigned_to_user_id = ?"); up.push(callerId); }
      if (search) { const q = String(search).trim().toLowerCase(); uw.push(`(u.person_name LIKE ? OR u.phone_number LIKE ?${q.length >= 4 && "unfiltered calls".includes(q) ? " OR 1 = 1" : ""})`); up.push(`%${search}%`, `%${search}%`); }
      if (sourceF && sourceF !== "unfiltered_calls") uw.push("1 = 0"); // every row here originated from Unfiltered Calls
      if (zoneId) { uw.push("u.zone_id = ?"); up.push(zoneId); }
      if (lokSabhaId) { uw.push("u.lok_sabha_id = ?"); up.push(lokSabhaId); }
      if (districtId) { uw.push("u.district_id = ?"); up.push(districtId); }
      if (assemblyId) { uw.push("u.assembly_id = ?"); up.push(assemblyId); }
      if (caller) { uw.push("u.assigned_to_user_id = ?"); up.push(caller); }
      if (statusF === "assigned") uw.push("u.assigned_to_user_id IS NOT NULL");
      if (statusF === "unassigned") uw.push("u.assigned_to_user_id IS NULL");
      if (reason) { uw.push("u.wrong_number_reason = ?"); up.push(reason); }
      if (designationId) uw.push("1 = 0"); // unfiltered records carry a free-text designation, not a Master Data id
      if (dateFrom) { uw.push("DATE(u.completed_at) >= ?"); up.push(dateFrom); }
      if (dateTo) { uw.push("DATE(u.completed_at) <= ?"); up.push(dateTo); }
      const ur = await query(
        `SELECT u.id, u.person_name, u.phone_number, u.address, u.assigned_to_user_id, au.username AS caller_name,
                u.designation AS designation_name, lz.name AS zone_name, lls.name AS lok_sabha_name,
                COALESCE(ld.name, u.district_name) AS district_name, COALESCE(la.name, u.assembly_name) AS assembly_name, lw.name AS ward_name,
                u.photo_url, u.wrong_number_reason, u.call_notes AS wrong_number_notes, u.completed_at AS marked_wrong_date,
                cb.username AS marked_by_name, u.call_notes AS last_remarks,
                (SELECT COUNT(*) FROM unfiltered_call_logs x WHERE x.unfiltered_contact_id = u.id) AS attempts,
                (SELECT COUNT(*) FROM unfiltered_call_logs x WHERE x.unfiltered_contact_id = u.id AND x.status_name = 'Wrong Number') AS wrong_attempts
           FROM unfiltered_contacts u
           LEFT JOIN users au ON au.id = u.assigned_to_user_id
           LEFT JOIN users cb ON cb.id = u.completed_by
           LEFT JOIN locations lz ON lz.id = u.zone_id
           LEFT JOIN locations lls ON lls.id = u.lok_sabha_id
           LEFT JOIN locations ld ON ld.id = u.district_id
           LEFT JOIN locations la ON la.id = u.assembly_id
           LEFT JOIN locations lw ON lw.id = u.ward_id
          WHERE ${uw.join(" AND ")}
          ORDER BY u.completed_at DESC, u.id DESC LIMIT 2000`,
        up
      );
      unfRows = ur.map((r) => ({ ...r, id: `u${r.id}`, unfiltered_id: r.id, row_type: "unfiltered", source: "unfiltered_calls", source_label: "Unfiltered Calls" }));
    }

    const rows = !(await hasWrongNumberColumn()) ? [] : await query(
      `SELECT * FROM (
        SELECT c.id, c.person_name, c.phone_number, c.address, c.assigned_to_user_id,
              u.username AS caller_name,
              COALESCE(NULLIF(TRIM(w.position), ''), dsg.name) AS designation_name,
              COALESCE(lz.name, dz.name) AS zone_name, COALESCE(lls.name, dls.name) AS lok_sabha_name, ld.name AS district_name,
              la.name AS assembly_name, lw.name AS ward_name,
              COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) AS photo_url,
              ${detailCols}
              ${await sourceSelectSql("c")},
              (SELECT COUNT(*) FROM calls x WHERE x.contact_id = c.id) AS attempts,
              (SELECT COUNT(*) FROM calls x JOIN call_statuses cs2 ON cs2.id = x.status_id
                 WHERE x.contact_id = c.id AND cs2.name = 'Wrong Number') AS wrong_attempts,
              (SELECT MAX(x.called_at) FROM calls x WHERE x.contact_id = c.id) AS last_call_date,
              (SELECT MAX(x.called_at) FROM calls x JOIN call_statuses cs ON cs.id = x.status_id
                 WHERE x.contact_id = c.id AND cs.name = 'Wrong Number') AS marked_wrong_date,
              (SELECT x.remarks FROM calls x WHERE x.contact_id = c.id ORDER BY x.called_at DESC, x.id DESC LIMIT 1) AS last_remarks
         FROM contacts c
         LEFT JOIN users u ON u.id = c.assigned_to_user_id
         LEFT JOIN workers w ON w.id = c.worker_id
         LEFT JOIN designations dsg ON dsg.id = c.designation_id
         LEFT JOIN locations lz ON lz.id = c.zone_id
         LEFT JOIN locations lls ON lls.id = c.lok_sabha_id
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations dls ON dls.id = ld.parent_id AND dls.type = 'lok_sabha'
         LEFT JOIN locations dz ON dz.id = dls.parent_id
         LEFT JOIN locations la ON la.id = c.assembly_id
         LEFT JOIN locations lw ON lw.id = c.ward_id
         ${detailJoins}
        WHERE ${where.join(" AND ")}
      ) t
      ${outerWhere}
      ORDER BY t.marked_wrong_date DESC, t.id DESC
      LIMIT 2000`,
      [...params, ...outerParams]
    );

    for (const r of rows) r.source_label = contactSourceLabel(r); // null = no source recorded (the page shows 'Not Available')
    const all = [...rows, ...unfRows].sort((a, b) => (new Date(b.marked_wrong_date || 0)) - (new Date(a.marked_wrong_date || 0)));
    return NextResponse.json({ wrong_numbers: all, total: all.length });
  } catch (err) {
    console.error("wrong-numbers GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
