import { query } from "@/lib/db";
import { isOversight, isCaller, isSupervisorRole, scopeFilterSync, normalizeRole, ROLES } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { isSupervisor } from "@/lib/auth";
import { resolveActingUserId } from "@/lib/actAs";
import { supervisorScopeFilter } from "@/lib/supervisorScope";
import { ensureNotInterestedColumns, notInterestedRestoredGuard, hasWrongNumberColumn, hasWrongNumberDetailColumns } from "@/lib/contactExtras";
import { repeatOffSelect, ensureRepeatOffSchema } from "@/lib/repeatOff";
import { ensureUnfilteredCallLogSchema } from "@/lib/unfilteredContacts";
import { sourceKeySql, sourceSearchOr, STATUS_SOURCES } from "@/lib/contactSource";
import { NOT_IN_SERVICE_SQL } from "@/lib/wrongNumberRestore";

// ONE read model for the consolidated Status Management page (the former Wrong Number, Not Interested, 10+ Switched Off and
// 10+ Incoming Off pages). Nothing is copied or migrated: every row is read live from where it already lives -
//   contacts (+ calls)            -> Contact / Registration / Unfiltered-origin contacts
//   unfiltered_contacts           -> Unfiltered Calls marked Wrong Number that have no Contact (as on the old Wrong Number page)
// and each row carries the four category flags (v_wn / v_ni / v_sw / v_in) computed by the SAME rules the four old pages used, each
// ANDed with that old page's own permission + scope. A row is listed when at least one flag it may see is set, so nobody gains access.
// The page, pagination, status and source filters are all applied in SQL.

export const CATEGORY_STATUSES = ["Wrong Number", "Not Interested", "Switched Off", "Incoming Off"];
// Text columns of the two halves of the UNION are normalised to one collation (the Contact and Unfiltered tables differ).
const T = (e) => `CONVERT(${e} USING utf8mb4) COLLATE utf8mb4_general_ci`;
const SORTS = { recent: "t.activity_at DESC, t.rid DESC", name: "t.person_name ASC, t.rid ASC" };

let colsPromise;
async function contactColumns() {
  if (!colsPromise) {
    colsPromise = query("SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts'")
      .then((r) => new Set(r.map((x) => x.name))).catch((e) => { colsPromise = undefined; throw e; });
  }
  return colsPromise;
}

// The unified Status options: every status the calling workflows define (Regular + Unfiltered share call_statuses), de-duplicated by
// label, plus the Not Interested category (not a call status). Order: the four category statuses first, then the rest by id.
export async function statusOptions() {
  await ensureRepeatOffSchema().catch(() => {});
  const rows = await query("SELECT MIN(id) AS id, name FROM call_statuses WHERE name IS NOT NULL AND TRIM(name) <> '' GROUP BY name ORDER BY MIN(id)");
  const names = rows.map((r) => String(r.name));
  const ordered = [...CATEGORY_STATUSES, ...names.filter((n) => !CATEGORY_STATUSES.includes(n))];
  return ordered.map((n) => ({ value: n, label: n, category: CATEGORY_STATUSES.includes(n) }));
}

// Which of the four categories may this user see? (the old pages' own gates)
export async function allowedCategories(session) {
  if (!session?.user) return { wn: false, wnUnf: false, ni: false, sw: false, in: false };
  const oversight = isOversight(session);
  const caller = isCaller(session);
  const wnPage = await pageAllowed(session, "wrong_numbers", oversight || caller);
  const wn = wnPage && oversight;                     // the contact list of wrong numbers: oversight only
  const wnUnf = wnPage && (oversight || caller);      // Unfiltered wrong numbers: oversight (global scope) or the caller's own
  const ni = await pageAllowed(session, "not_interested", true);
  const rep = oversight && wnPage && await pageAllowed(session, "contacts", !!isSupervisor(session));
  return { wn, wnUnf, ni, sw: rep, in: rep };
}

export async function queryStatusManagement(session, f = {}) {
  const allow = await allowedCategories(session);
  if (!allow.wn && !allow.wnUnf && !allow.ni && !allow.sw && !allow.in) return { status: 401, message: "Unauthorized" };

  const oversight = isOversight(session);
  const callerOnly = !oversight;
  let actingId = null;
  if (callerOnly) actingId = (await resolveActingUserId(session)).userId;
  const hasWn = await hasWrongNumberColumn();
  const hasDetail = hasWn && await hasWrongNumberDetailColumns();
  const niReady = await ensureNotInterestedColumns();
  const cols = await contactColumns();
  const role = normalizeRole(session.user.role);

  // ---- validated filters ----
  const options = await statusOptions();
  const statusF = f.status ? String(f.status) : "";
  if (statusF && !options.some((o) => o.value === statusF)) return { status: 400, message: "Unknown status." };
  const sourceF = f.source ? String(f.source) : "";
  if (sourceF && !STATUS_SOURCES.some((o) => o.value === sourceF)) return { status: 400, message: "Unknown source." };
  const page = Math.max(1, parseInt(f.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(f.page_size, 10) || 50));
  const sortSql = SORTS[f.sort] || SORTS.recent;

  const P = [];                       // params in textual order of the final SQL
  const add = (frag, ...ps) => { P.push(...ps); return frag; };

  // ---- category flags for CONTACT rows (each ANDed with the old page's scope) ----
  const scoped = (scope) => (scope && scope.where ? { sql: ` AND (${scope.where.replace(/^\s*AND\s+/i, "")})`, params: scope.params || [] } : { sql: "", params: [] });
  const NIS = hasDetail ? NOT_IN_SERVICE_SQL("c", true) : NOT_IN_SERVICE_SQL("c", false);

  const wnScope = scoped(scopeFilterSync(session.user, "c"));
  const wnFlag = () => (allow.wn && hasWn ? add(`(c.is_wrong_number = 1${wnScope.sql})`, ...wnScope.params) : "0");

  let niScope = { sql: "", params: [] };
  if (isCaller(session)) niScope = { sql: " AND c.assigned_to_user_id = ?", params: [session.user.id] };
  else if (isSupervisorRole(session)) niScope = scoped(supervisorScopeFilter(session.user, "c"));
  else if (role !== ROLES.SUPER_ADMIN && role !== ROLES.STATE_ADMIN) niScope = scoped(scopeFilterSync(session.user, "c"));
  const switchedExpr = cols.has("wrong_number_reason") && cols.has("wrong_attempts")
    ? "(CASE WHEN c.wrong_number_reason = 'switched_off' THEN COALESCE(c.wrong_attempts, 0) ELSE 0 END)" : "0";
  const sentimentDefault = niReady ? "COALESCE(c.is_not_interested,0) = 1" : "(COALESCE(agg.has_negative,0) = 1 OR COALESCE(agg.has_opponent,0) = 1 OR COALESCE(agg.has_not_supporter,0) = 1)";
  let niGuard = "";
  if (niReady && cols.has("not_interested_restored_call_id")) niGuard = notInterestedRestoredGuard("c", "agg");
  else if (cols.has("not_interested_restored_at")) niGuard = " AND (c.not_interested_restored_at IS NULL OR agg.last_call_date > c.not_interested_restored_at)";
  const niFlag = () => (allow.ni ? add(`((${switchedExpr} > 5 OR ${sentimentDefault} OR COALESCE(agg.has_rude,0) = 1)${niGuard}${niScope.sql})`, ...niScope.params) : "0");

  const swSel = await repeatOffSelect("switched", "c");
  const inSel = await repeatOffSelect("incoming", "c");
  const repScope = scoped(scopeFilterSync(session.user, "c"));
  const swFlag = () => (allow.sw ? add(`(1 = 1${swSel.where}${repScope.sql})`, ...repScope.params) : "0");
  const inFlag = () => (allow.in ? add(`(1 = 1${inSel.where}${repScope.sql})`, ...repScope.params) : "0");

  // ---- Unfiltered rows: only wrong numbers, as the old page (callers: their own; oversight: global scope only) ----
  const unfScopeOk = allow.wnUnf && (callerOnly || !scopeFilterSync(session.user, "c").where);

  const sk = await sourceKeySql("c");
  const have = new Set((await query("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts' AND COLUMN_NAME IN ('source','source_unfiltered_contact_id','source_registration_id')")).map((r) => r.c));
  const cc = (n) => (have.has(n) ? `c.${n}` : "NULL");

  // ---- filters shared by both halves (inner WHERE) ----
  const innerFilters = (kind) => {
    const w = [], ps = [];
    const a = kind === "c" ? "c" : "u";
    if (f.search) {
      const s = String(f.search);
      w.push(kind === "c" ? `(c.person_name LIKE ? OR c.phone_number LIKE ?__SRC__)` : `(u.person_name LIKE ? OR u.phone_number LIKE ?)`);
      ps.push(`%${s}%`, `%${s}%`);
    }
    if (f.zone_id) { w.push(kind === "c" ? "(c.zone_id = ? OR (c.zone_id IS NULL AND dz.id = ?))" : "u.zone_id = ?"); ps.push(f.zone_id); if (kind === "c") ps.push(f.zone_id); }
    if (f.lok_sabha_id) { w.push(kind === "c" ? "(c.lok_sabha_id = ? OR (c.lok_sabha_id IS NULL AND dls.id = ?))" : "u.lok_sabha_id = ?"); ps.push(f.lok_sabha_id); if (kind === "c") ps.push(f.lok_sabha_id); }
    if (f.district_id) { w.push(`${a}.district_id = ?`); ps.push(f.district_id); }
    if (f.assembly_id) { w.push(`${a}.assembly_id = ?`); ps.push(f.assembly_id); }
    if (f.caller) { w.push(`${a}.assigned_to_user_id = ?`); ps.push(f.caller); }
    if (f.assignment === "assigned") w.push(`${a}.assigned_to_user_id IS NOT NULL`);
    if (f.assignment === "unassigned") w.push(`${a}.assigned_to_user_id IS NULL`);
    if (f.designation_id) { w.push(kind === "c" ? "c.designation_id = ?" : "1 = 0"); if (kind === "c") ps.push(f.designation_id); }
    if (f.reason) { w.push(kind === "c" ? (hasDetail ? "c.wrong_number_reason = ?" : "1 = 0") : "u.wrong_number_reason = ?"); if (kind === "c" ? hasDetail : true) ps.push(f.reason); }
    return { w, ps };
  };

  // ---- contact half ----
  const cf = innerFilters("c");
  const srcOr = f.search ? await sourceSearchOr(f.search, "c") : "";
  const cWhere = cf.w.length ? `WHERE ${cf.w.join(" AND ").replace("__SRC__", srcOr)}` : "";
  const detailCols = hasDetail ? `${T("c.wrong_number_reason")} AS wrong_number_reason, ${T("c.wrong_number_notes")} AS wrong_number_notes, ${T("mb.username")} AS marked_by_name` : "NULL AS wrong_number_reason, NULL AS wrong_number_notes, NULL AS marked_by_name";
  const detailJoin = hasDetail ? "LEFT JOIN users mb ON mb.id = c.wrong_number_by" : "";
  const hasCreated = cols.has("created_at");

  // The per-contact call aggregate (same as the Not Interested page)
  const AGG = `LEFT JOIN (
        SELECT cx.contact_id, COUNT(*) AS total_calls, MAX(cx.called_at) AS last_call_date, MAX(cx.id) AS last_call_id,
               MAX(cx.sentiment = 'negative') AS has_negative, MAX(cx.sentiment = 'opponent') AS has_opponent,
               MAX(cx.sentiment = 'not_supporter') AS has_not_supporter,
               MAX(cs.name IN ('Rudely Behaved', 'Rude', 'Rudely Rejected')) AS has_rude
          FROM calls cx LEFT JOIN call_statuses cs ON cs.id = cx.status_id GROUP BY cx.contact_id) agg ON agg.contact_id = c.id`;

  // Build the SELECT list parts in text order: flags first? No - params must follow textual order, so build the string pieces now.
  const flagWn = wnFlag(), flagNi = niFlag(), flagSw = swFlag(), flagIn = inFlag();   // each pushes its params in this order
  const contactSelect = `
    SELECT ${T("'contact'")} AS row_type, ${T("CONCAT('c', c.id)")} AS rid, c.id AS contact_id, NULL AS unfiltered_id,
           ${T('c.person_name')} AS person_name, ${T('c.phone_number')} AS phone_number, ${T('c.address')} AS address, c.assigned_to_user_id, ${T('u.username')} AS caller_name,
           ${T("COALESCE(NULLIF(TRIM(w.position), ''), dsg.name)")} AS designation_name,
           ${T('COALESCE(lz.name, dz.name)')} AS zone_name, ${T('COALESCE(lls.name, dls.name)')} AS lok_sabha_name, ${T('ld.name')} AS district_name,
           ${T('la.name')} AS assembly_name, ${T('lw.name')} AS ward_name,
           ${T("COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), ''))")} AS photo_url,
           ${T(cc("source"))} AS source, ${cc("source_unfiltered_contact_id")} AS source_unfiltered_contact_id, ${cc("source_registration_id")} AS source_registration_id,
           ${T(sk)} AS source_key, ${detailCols},
           (SELECT MAX(x.called_at) FROM calls x JOIN call_statuses csw ON csw.id = x.status_id WHERE x.contact_id = c.id AND csw.name = 'Wrong Number') AS marked_wrong_date,
           ${T('(SELECT x.remarks FROM calls x WHERE x.contact_id = c.id ORDER BY x.called_at DESC, x.id DESC LIMIT 1)')} AS last_remarks,
           COALESCE(agg.total_calls, 0) AS attempts,
           (SELECT COUNT(*) FROM calls x JOIN call_statuses cs2 ON cs2.id = x.status_id WHERE x.contact_id = c.id AND cs2.name = 'Wrong Number') AS wrong_attempts,
           ${T('(SELECT csl.name FROM calls xl JOIN call_statuses csl ON csl.id = xl.status_id WHERE xl.id = agg.last_call_id)')} AS latest_status,
           (CASE WHEN ${NIS} THEN 1 ELSE 0 END) AS not_in_service,
           ${swSel.countExpr} AS switched_off_count, ${inSel.countExpr} AS incoming_off_count,
           COALESCE(agg.has_rude, 0) AS has_rude, COALESCE(agg.has_negative, 0) AS has_negative, COALESCE(agg.has_opponent, 0) AS has_opponent, COALESCE(agg.has_not_supporter, 0) AS has_not_supporter,
           agg.last_call_date AS last_call_date,
           COALESCE(agg.last_call_date, ${hasDetail ? "c.wrong_number_at, " : ""}${hasCreated ? "c.created_at, " : ""}'1970-01-01') AS activity_at,
           ${flagWn} AS v_wn, ${flagNi} AS v_ni, ${flagSw} AS v_sw, ${flagIn} AS v_in
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
      ${detailJoin}
      ${AGG}
      ${cWhere}`;
  // NOTE: the inner-WHERE params come AFTER the select-list params in the text, so append them now.
  P.push(...cf.ps);

  // ---- unfiltered half ----
  let unfSelect = "";
  if (unfScopeOk) {
    await ensureUnfilteredCallLogSchema();
    const uf = innerFilters("u");
    const uw = [...uf.w];
    uw.push("(u.call_status_name = 'Wrong Number' OR (u.call_status_name = 'Phone Picked' AND u.call_sentiment = 'wrong_number'))", "u.completed_at IS NOT NULL");
    const ups = [...uf.ps];
    if (callerOnly) { uw.push("u.assigned_to_user_id = ?"); ups.push(actingId); }
    // a record already represented by its (wrong-number) Contact row is not shown twice
    uw.push("NOT EXISTS (SELECT 1 FROM contacts lc WHERE lc.id = u.contact_id AND lc.is_wrong_number = 1)");
    unfSelect = `
    SELECT ${T("'unfiltered'")} AS row_type, ${T("CONCAT('u', u.id)")} AS rid, NULL AS contact_id, u.id AS unfiltered_id,
           ${T('u.person_name')} AS person_name, ${T('u.phone_number')} AS phone_number, ${T('u.address')} AS address, u.assigned_to_user_id, ${T('au.username')} AS caller_name,
           ${T('u.designation')} AS designation_name, ${T('lz.name')} AS zone_name, ${T('lls.name')} AS lok_sabha_name,
           ${T('COALESCE(ld.name, u.district_name)')} AS district_name, ${T('COALESCE(la.name, u.assembly_name)')} AS assembly_name, ${T('lw.name')} AS ward_name,
           ${T('u.photo_url')} AS photo_url, ${T("'unfiltered_calls'")} AS source, NULL AS source_unfiltered_contact_id, NULL AS source_registration_id,
           ${T("'unfiltered_calls'")} AS source_key, ${T('u.wrong_number_reason')} AS wrong_number_reason, ${T('u.call_notes')} AS wrong_number_notes, ${T('cb.username')} AS marked_by_name,
           u.completed_at AS marked_wrong_date, ${T('u.call_notes')} AS last_remarks,
           (SELECT COUNT(*) FROM unfiltered_call_logs x WHERE x.unfiltered_contact_id = u.id) AS attempts,
           (SELECT COUNT(*) FROM unfiltered_call_logs x WHERE x.unfiltered_contact_id = u.id AND x.status_name = 'Wrong Number') AS wrong_attempts,
           ${T('u.call_status_name')} AS latest_status, 0 AS not_in_service, 0 AS switched_off_count, 0 AS incoming_off_count,
           0 AS has_rude, 0 AS has_negative, 0 AS has_opponent, 0 AS has_not_supporter,
           u.completed_at AS last_call_date, COALESCE(u.completed_at, u.assigned_at, '1970-01-01') AS activity_at,
           1 AS v_wn, 0 AS v_ni, 0 AS v_sw, 0 AS v_in
      FROM unfiltered_contacts u
      LEFT JOIN users au ON au.id = u.assigned_to_user_id
      LEFT JOIN users cb ON cb.id = u.completed_by
      LEFT JOIN locations lz ON lz.id = u.zone_id
      LEFT JOIN locations lls ON lls.id = u.lok_sabha_id
      LEFT JOIN locations ld ON ld.id = u.district_id
      LEFT JOIN locations la ON la.id = u.assembly_id
      LEFT JOIN locations lw ON lw.id = u.ward_id
     WHERE ${uw.join(" AND ")}`;
    P.push(...ups);
  }

  const union = unfSelect ? `${contactSelect}\n UNION ALL ${unfSelect}` : contactSelect;

  // ---- outer filters: visible in some category, then Source and Status ----
  const outer = ["(t.v_wn = 1 OR t.v_ni = 1 OR t.v_sw = 1 OR t.v_in = 1)"];
  const outerParams = [];
  if (sourceF) { outer.push("t.source_key = ?"); outerParams.push(sourceF); }
  if (f.date_from) { outer.push("DATE(t.activity_at) >= ?"); outerParams.push(f.date_from); }
  if (f.date_to) { outer.push("DATE(t.activity_at) <= ?"); outerParams.push(f.date_to); }
  const statusClause = () => {
    switch (statusF) {
      case "": return "";
      case "Wrong Number": return "t.v_wn = 1";
      case "Not Interested": return "t.v_ni = 1";
      case "Switched Off": return "t.v_sw = 1";
      case "Incoming Off": return "t.v_in = 1";
      case "Not in Service": return "(t.latest_status = 'Not in Service' OR (t.v_wn = 1 AND t.not_in_service = 1))";
      case "Rudely Behaved": return "(t.latest_status = 'Rudely Behaved' OR t.has_rude = 1)";
      default: return null;                                   // plain call status: the record's latest saved status
    }
  };
  const sc = statusClause();
  const statusParams = [];
  if (sc === null) { outer.push("t.latest_status = ?"); statusParams.push(statusF); }
  else if (sc) outer.push(sc);
  const outerSql = outer.join(" AND ");
  // counts per category over the same source / search filters (but NOT the status filter), for the page's category chips
  const countOuter = ["(t.v_wn = 1 OR t.v_ni = 1 OR t.v_sw = 1 OR t.v_in = 1)", ...(sourceF ? ["t.source_key = ?"] : []), ...(f.date_from ? ["DATE(t.activity_at) >= ?"] : []), ...(f.date_to ? ["DATE(t.activity_at) <= ?"] : [])];

  const baseParams = [...P];
  const filtParams = [...outerParams.slice(0, (sourceF ? 1 : 0)), ...outerParams.slice(sourceF ? 1 : 0), ...statusParams];

  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM (${union}) t WHERE ${outerSql}`, [...baseParams, ...filtParams]);
  const rows = await query(
    `SELECT t.* FROM (${union}) t WHERE ${outerSql} ORDER BY ${sortSql} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    [...baseParams, ...filtParams]
  );
  const [cnt] = await query(
    `SELECT SUM(t.v_wn = 1) AS wn, SUM(t.v_ni = 1) AS ni, SUM(t.v_sw = 1) AS sw, SUM(t.v_in = 1) AS inc, COUNT(*) AS records FROM (${union}) t WHERE ${countOuter.join(" AND ")}`,
    [...baseParams, ...outerParams.slice(0, countOuter.length - 1)]
  );

  const out = rows.map((r) => {
    const unf = r.row_type === "unfiltered";
    const cats = [];
    if (Number(r.v_wn) === 1) cats.push("wrong_number");
    if (Number(r.v_ni) === 1) cats.push("not_interested");
    if (Number(r.v_sw) === 1) cats.push("switched_off");
    if (Number(r.v_in) === 1) cats.push("incoming_off");
    return { ...r, id: unf ? `u${r.unfiltered_id}` : r.contact_id, categories: cats, source_label: STATUS_SOURCES.find((s) => s.value === r.source_key)?.label || null };
  });
  return {
    status: 200, rows: out, total: Number(total) || 0, page, page_size: pageSize, total_pages: Math.max(1, Math.ceil((Number(total) || 0) / pageSize)),
    counts: { wrong_number: Number(cnt?.wn) || 0, not_interested: Number(cnt?.ni) || 0, switched_off: Number(cnt?.sw) || 0, incoming_off: Number(cnt?.inc) || 0, records: Number(cnt?.records) || 0 },
    allowed: { wrong_number: allow.wn || allow.wnUnf, not_interested: allow.ni, switched_off: allow.sw, incoming_off: allow.in },
  };
}
