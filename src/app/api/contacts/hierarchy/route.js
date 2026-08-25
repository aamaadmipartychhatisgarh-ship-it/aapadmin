import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { scopeFilterSync } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { notWrongNumberClause } from "@/lib/contactExtras";
import { ensureContactDesignationsSchema, DESIGNATION_NAMES_SQL } from "@/lib/contactDesignations";

export const dynamic = "force-dynamic";

// PROMPT 6 — designation-wise people grouped by a chosen geographic level, from
// the LIVE contacts + designation-master data (no hardcoding). Params:
//   level        = state | zone | lok_sabha | district | assembly | block
//   designation_id (optional) → only people who hold that designation
// Returns groups: [{ name, count, people:[{ id, person_name, phone_number,
// address, designations, photo_url }] }] plus totals.
const LEVEL_EXPR = {
  state: "'State'",
  zone: "COALESCE(cz.name, lz.name)",
  lok_sabha: "COALESCE(cls.name, lls.name)",
  district: "ld.name",
  assembly: "la.name",
  block: "lw.name",
};
// Each contact's location ID at a given level (contact's own column, or derived
// up the district hierarchy for zone / lok sabha).
const LEVEL_ID_EXPR = {
  zone: "COALESCE(c.zone_id, lz.id)",
  lok_sabha: "COALESCE(c.lok_sabha_id, lls.id)",
  district: "c.district_id",
  assembly: "c.assembly_id",
  block: "c.ward_id",
};
// The location master `type` for each level (block = ward).
const LOC_TYPE = { zone: "zone", lok_sabha: "lok_sabha", district: "district", assembly: "assembly", block: "ward" };
const MAX_PEOPLE = 8000; // safety cap for one view
const SHOW_ALL_EMPTY_MAX = 60; // list every location (even empty) up to this many

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "contacts", session && isSupervisor(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    await ensureContactDesignationsSchema();

    const { searchParams } = new URL(req.url);
    const level = String(searchParams.get("level") || "district").toLowerCase();
    const groupExpr = LEVEL_EXPR[level];
    if (!groupExpr) return NextResponse.json({ message: "Invalid level." }, { status: 400 });
    const designationId = parseInt(searchParams.get("designation_id"), 10);
    const hasDesignation = Number.isInteger(designationId) && designationId > 0;

    // ---- STATE level: a designation-wise matrix (PROMPT 7) --------------------
    // Every designation from the master, each with the people who hold it
    // state-wide — Person Name + Photo ONLY (no phone/address/status/etc.). A
    // designation with nobody assigned still appears, with a blank person area.
    if (level === "state") {
      const scope = scopeFilterSync(session.user, "c");
      const notWrong = await notWrongNumberClause("c");
      const desWhere = hasDesignation ? "WHERE d.id = ?" : "";
      const rows = await query(
        `SELECT d.id AS designation_id, d.name AS designation_name, d.sort_order,
                c.id AS contact_id, c.person_name,
                COALESCE(c.photo_url, w.photo_url) AS photo_url
           FROM designations d
           LEFT JOIN contact_designations cd ON cd.designation_id = d.id
           LEFT JOIN contacts c ON c.id = cd.contact_id ${notWrong} ${scope.where}
           LEFT JOIN workers w ON w.id = c.worker_id
          ${desWhere}
          ORDER BY (d.sort_order IS NULL), d.sort_order, d.name, c.person_name`,
        hasDesignation ? [...scope.params, designationId] : [...scope.params]
      );
      const byDes = new Map();
      for (const r of rows) {
        if (!byDes.has(r.designation_id)) {
          byDes.set(r.designation_id, { id: r.designation_id, name: r.designation_name, people: [] });
        }
        // Person-name Only + Photo. Skip the LEFT-JOIN "no contact" placeholder row.
        if (r.contact_id) byDes.get(r.designation_id).people.push({ id: r.contact_id, person_name: r.person_name, photo_url: r.photo_url });
      }
      const designations = [...byDes.values()];
      const totalPeople = designations.reduce((s, d) => s + d.people.length, 0);
      return NextResponse.json({ level: "state", state_name: "State", designations, total: totalPeople });
    }

    // ---- ZONE / LOK SABHA / DISTRICT / ASSEMBLY / BLOCK ---------------------
    // Per-location designation matrix (PROMPT 8+): list every location of the
    // level, and under each show every designation with the people (Name +
    // Photo ONLY) who hold it in that location — blank when unfilled.
    const scope = scopeFilterSync(session.user, "c");
    const notWrong = await notWrongNumberClause("c");
    const levelIdExpr = LEVEL_ID_EXPR[level];

    // 1) Designation master (optionally narrowed by the dropdown).
    const designations = await query(
      `SELECT id, name FROM designations ${hasDesignation ? "WHERE id = ?" : ""}
        ORDER BY (sort_order IS NULL), sort_order, name`,
      hasDesignation ? [designationId] : []
    );

    // 2) All locations of this level from the master.
    const masterLocs = await query(
      `SELECT id, name FROM locations WHERE type = ? ORDER BY name LIMIT ${SHOW_ALL_EMPTY_MAX * 20}`,
      [LOC_TYPE[level]]
    );

    // 3) Every (person × designation) with the person's location id at this level.
    const desFilter = hasDesignation ? " AND cd.designation_id = ?" : "";
    const peopleRows = await query(
      `SELECT ${levelIdExpr} AS loc_id, cd.designation_id,
              c.id AS contact_id, c.person_name,
              COALESCE(c.photo_url, w.photo_url) AS photo_url
         FROM contacts c
         JOIN contact_designations cd ON cd.contact_id = c.id
         LEFT JOIN workers w ON w.id = c.worker_id
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations lls ON lls.id = ld.parent_id
         LEFT JOIN locations lz ON lz.id = lls.parent_id
        WHERE 1=1 ${notWrong}${desFilter} ${scope.where}
        ORDER BY c.person_name
        LIMIT ${MAX_PEOPLE}`,
      hasDesignation ? [designationId, ...scope.params] : [...scope.params]
    );

    // grouped: loc_id → (designation_id → people[]).
    const grouped = new Map();
    let totalPeople = 0;
    for (const r of peopleRows) {
      const loc = r.loc_id ?? 0; // 0 = no location at this level
      if (!grouped.has(loc)) grouped.set(loc, new Map());
      const byDes = grouped.get(loc);
      if (!byDes.has(r.designation_id)) byDes.set(r.designation_id, []);
      byDes.get(r.designation_id).push({ id: r.contact_id, person_name: r.person_name, photo_url: r.photo_url });
      totalPeople++;
    }

    // Which locations to show: every master location when few enough (so empty
    // zones still appear, §"display all available Zones"); otherwise only those
    // that actually have people (keeps big levels usable).
    const showAllEmpty = masterLocs.length <= SHOW_ALL_EMPTY_MAX;
    let locs = showAllEmpty ? masterLocs : masterLocs.filter((l) => grouped.has(l.id));
    // Contacts with no location at this level → an "Unassigned" group at the end.
    if (grouped.has(0)) locs = [...locs, { id: 0, name: "Unassigned" }];

    const buildDesignations = (locId) => {
      const byDes = grouped.get(locId);
      return designations.map((d) => ({ id: d.id, name: d.name, people: byDes?.get(d.id) || [] }));
    };
    const groups = locs.map((l) => ({ id: l.id, name: l.name, designations: buildDesignations(l.id) }));

    return NextResponse.json({
      level,
      total: totalPeople,
      groups,
      capped: peopleRows.length >= MAX_PEOPLE,
      matrix: true,
    });
  } catch (err) {
    console.error("contacts hierarchy error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
