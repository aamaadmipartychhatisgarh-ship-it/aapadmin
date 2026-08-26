import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, scopeFilterSync } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { notWrongNumberClause } from "@/lib/contactExtras";
import { ensureContactDesignationsSchema, DESIGNATION_IDS_SQL, DESIGNATION_NAMES_SQL } from "@/lib/contactDesignations";

export const dynamic = "force-dynamic";

// CONTACTS → INCOMPLETE DESIGNATION — a database-driven FILTERED VIEW of the
// existing contacts (no copy table): the contacts whose Designation / hierarchy
// (Zone, Lok Sabha, District, Assembly) is missing. A field counts as "missing"
// only when it can't be resolved from REAL master data — NULL id, an id that no
// longer resolves to a location (deleted/invalid ref), or (designation) no
// designation link at all. Zone/Lok Sabha resolve from the contact's own column
// OR the district hierarchy (district → lok_sabha → zone), matching the list.

const idList = (raw) =>
  raw ? [...new Set(String(raw).split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0))] : [];

// Each expression is TRUE when that hierarchy field is missing/unresolvable.
const MISS = {
  designation: `(c.designation_id IS NULL AND NOT EXISTS (SELECT 1 FROM contact_designations cd WHERE cd.contact_id = c.id))`,
  district: `(ld.id IS NULL)`,
  assembly: `(la.id IS NULL)`,
  lok_sabha: `(COALESCE(cls.id, lls.id) IS NULL)`,
  zone: `(COALESCE(cz.id, lz.id) IS NULL)`,
};
const ANY_INCOMPLETE = `(${MISS.designation} OR ${MISS.district} OR ${MISS.assembly} OR ${MISS.lok_sabha} OR ${MISS.zone})`;

// Same joins the main contacts list uses, so display + resolution match exactly.
const JOINS = `
   LEFT JOIN workers w ON w.id = c.worker_id
   LEFT JOIN users u ON u.id = c.assigned_to_user_id
   LEFT JOIN locations ld ON ld.id = c.district_id
   LEFT JOIN locations lls ON lls.id = ld.parent_id
   LEFT JOIN locations lz ON lz.id = lls.parent_id
   LEFT JOIN locations cz ON cz.id = c.zone_id
   LEFT JOIN locations cls ON cls.id = c.lok_sabha_id
   LEFT JOIN locations la ON la.id = c.assembly_id
   LEFT JOIN locations lw ON lw.id = c.ward_id
   LEFT JOIN designations dsg ON dsg.id = c.designation_id`;

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    // Same permission as Contacts; the page itself is admin-only.
    if (!(await pageAllowed(session, "contacts", session && isAdmin(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    await ensureContactDesignationsSchema();

    const { searchParams } = new URL(req.url);
    const zone_id = searchParams.get("zone_id");
    const lok_sabha_id = searchParams.get("lok_sabha_id");
    const district_id = searchParams.get("district_id");
    const assembly_ids = idList(searchParams.get("assembly_ids") || searchParams.get("assembly_id"));
    const designation_ids = idList(searchParams.get("designation_ids") || searchParams.get("designation_id"));
    const missing = searchParams.get("missing"); // designation|zone|lok_sabha|district|assembly
    const search = searchParams.get("search");
    const page = Math.max(1, parseInt(searchParams.get("page"), 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("page_size"), 10) || 50));
    const offset = (page - 1) * pageSize;

    const notWrong = await notWrongNumberClause("c");
    const scope = scopeFilterSync(session.user, "c");

    // The base every query shares: not-wrong-number + role scope + incomplete.
    const base = `${notWrong} ${scope.where} AND ${ANY_INCOMPLETE}`;

    // ---- Count cards — over the base (NOT the dropdown filters), so they always
    // reflect the full incomplete picture for this user's scope. Total = unique
    // contacts (one row each); per-field = contacts missing that field. A contact
    // can be missing several fields, so summing per-field never equals Total.
    const [cnt] = await query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(${MISS.designation}), 0) AS missing_designation,
              COALESCE(SUM(${MISS.zone}), 0) AS missing_zone,
              COALESCE(SUM(${MISS.lok_sabha}), 0) AS missing_lok_sabha,
              COALESCE(SUM(${MISS.district}), 0) AS missing_district,
              COALESCE(SUM(${MISS.assembly}), 0) AS missing_assembly
         FROM contacts c ${JOINS} WHERE 1=1 ${base}`,
      [...scope.params]
    );
    const counts = {
      total: Number(cnt?.total || 0),
      missing_designation: Number(cnt?.missing_designation || 0),
      missing_zone: Number(cnt?.missing_zone || 0),
      missing_lok_sabha: Number(cnt?.missing_lok_sabha || 0),
      missing_district: Number(cnt?.missing_district || 0),
      missing_assembly: Number(cnt?.missing_assembly || 0),
    };

    // ---- Filtered list --------------------------------------------------------
    let where = ` WHERE 1=1 ${base}`;
    const params = [...scope.params];
    if (zone_id) { where += ` AND COALESCE(c.zone_id, lz.id) = ?`; params.push(zone_id); }
    if (lok_sabha_id) { where += ` AND COALESCE(c.lok_sabha_id, lls.id) = ?`; params.push(lok_sabha_id); }
    if (district_id) { where += ` AND c.district_id = ?`; params.push(district_id); }
    if (assembly_ids.length) { where += ` AND c.assembly_id IN (${assembly_ids.map(() => "?").join(",")})`; params.push(...assembly_ids); }
    if (designation_ids.length) {
      const ph = designation_ids.map(() => "?").join(",");
      where += ` AND (c.designation_id IN (${ph}) OR EXISTS (SELECT 1 FROM contact_designations cd WHERE cd.contact_id = c.id AND cd.designation_id IN (${ph})))`;
      params.push(...designation_ids, ...designation_ids);
    }
    if (missing && MISS[missing]) where += ` AND ${MISS[missing]}`;
    if (search) { where += ` AND (c.person_name LIKE ? OR c.phone_number LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }

    const [ftot] = await query(`SELECT COUNT(*) AS total FROM contacts c ${JOINS} ${where}`, params);
    const total = Number(ftot?.total || 0);

    const rows = await query(
      `SELECT c.*,
              u.username AS assigned_to_username,
              ld.name AS district_name,
              lw.name AS ward_name,
              COALESCE(cz.name, lz.name) AS zone_name,
              COALESCE(cls.name, lls.name) AS lok_sabha_name,
              la.name AS assembly_name,
              -- The contact's OWN designation (multi then legacy). No worker-position
              -- fallback here, so the display matches the missing-designation flag.
              COALESCE(${DESIGNATION_NAMES_SQL}, dsg.name) AS designation_name,
              ${DESIGNATION_IDS_SQL} AS designation_ids,
              COALESCE(c.photo_url, w.photo_url) AS photo_url,
              ${MISS.designation} AS miss_designation,
              ${MISS.zone} AS miss_zone,
              ${MISS.lok_sabha} AS miss_lok_sabha,
              ${MISS.district} AS miss_district,
              ${MISS.assembly} AS miss_assembly
         FROM contacts c ${JOINS} ${where}
        ORDER BY c.id DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    const LABEL = { designation: "Designation", zone: "Zone", lok_sabha: "Lok Sabha", district: "District", assembly: "Assembly" };
    const contacts = rows.map((c) => {
      const missing_fields = [];
      if (Number(c.miss_designation)) missing_fields.push(LABEL.designation);
      if (Number(c.miss_zone)) missing_fields.push(LABEL.zone);
      if (Number(c.miss_lok_sabha)) missing_fields.push(LABEL.lok_sabha);
      if (Number(c.miss_district)) missing_fields.push(LABEL.district);
      if (Number(c.miss_assembly)) missing_fields.push(LABEL.assembly);
      return { ...c, missing_fields };
    });

    return NextResponse.json({ contacts, total, page, page_size: pageSize, counts });
  } catch (err) {
    console.error("contacts incomplete GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
