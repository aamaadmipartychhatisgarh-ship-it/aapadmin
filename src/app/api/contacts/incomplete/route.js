import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, scopeFilterSync } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { notWrongNumberClause } from "@/lib/contactExtras";
import { ensureContactDesignationsSchema } from "@/lib/contactDesignations";
import { ensureDesignationLevelColumn } from "@/lib/designationLevels";

export const dynamic = "force-dynamic";

// CONTACTS → INCOMPLETE DESIGNATION (Level & Designation-wise assignment).
// Pick a LEVEL (state | zone | lok_sabha | district | assembly | block); the API
// returns EVERY location at that level, and under each ONLY the designations
// mapped to that EXACT level (designations.level), each with the assigned
// person(s) — Photo + Name + Designation — or a Not-Assigned state. A location
// never borrows a person from another level, location or designation.

// The contact's location id at a given level: its own column, or derived up the
// district hierarchy for zone / lok_sabha.
const LEVEL_ID_EXPR = {
  zone: "COALESCE(c.zone_id, lz.id)",
  lok_sabha: "COALESCE(c.lok_sabha_id, lls.id)",
  district: "c.district_id",
  assembly: "c.assembly_id",
  block: "c.ward_id",
};
// The location master `type` for each level (block = ward).
const LOC_TYPE = { zone: "zone", lok_sabha: "lok_sabha", district: "district", assembly: "assembly", block: "ward" };
const MAX_PEOPLE = 8000;
const MAX_LOCS = 2000;

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "contacts", session && isAdmin(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    await ensureContactDesignationsSchema();
    await ensureDesignationLevelColumn(query);

    const { searchParams } = new URL(req.url);
    const level = String(searchParams.get("level") || "state").toLowerCase();
    const VALID = ["state", "zone", "lok_sabha", "district", "assembly", "block"];
    if (!VALID.includes(level)) return NextResponse.json({ message: "Invalid level." }, { status: 400 });
    const designationId = parseInt(searchParams.get("designation_id"), 10);
    const hasDesignation = Number.isInteger(designationId) && designationId > 0;

    const scope = scopeFilterSync(session.user, "c");
    const notWrong = await notWrongNumberClause("c");

    // Designations mapped to EXACTLY this level (strict — no cross-level, no
    // NULL-level fallback), optionally narrowed by the Designation dropdown.
    const desConds = ["d.level = ?"];
    const desParams = [level];
    if (hasDesignation) { desConds.push("d.id = ?"); desParams.push(designationId); }
    const designations = await query(
      `SELECT d.id, d.name FROM designations d WHERE ${desConds.join(" AND ")}
        ORDER BY (d.sort_order IS NULL), d.sort_order, d.name`,
      desParams
    );
    const allowedDes = new Set(designations.map((d) => d.id));

    // The designations dropdown list for this level (always the full level set,
    // regardless of the current designation filter) so the client can populate
    // it without a second call.
    const levelDesignations = hasDesignation
      ? await query(`SELECT id, name FROM designations WHERE level = ? ORDER BY (sort_order IS NULL), sort_order, name`, [level])
      : designations;

    const buildDesignations = (peopleByDes) =>
      designations.map((d) => ({
        id: d.id,
        name: d.name,
        people: (peopleByDes?.get(d.id) || []).map((p) => ({ ...p, designation: d.name })),
      }));

    // ---- STATE — a single location (the state). People holding a state-level
    // designation, state-wide. ------------------------------------------------
    if (level === "state") {
      const rows = await query(
        `SELECT cd.designation_id, c.id AS contact_id, c.person_name,
                COALESCE(c.photo_url, w.photo_url) AS photo_url
           FROM contacts c
           JOIN contact_designations cd ON cd.contact_id = c.id
           JOIN designations d ON d.id = cd.designation_id AND d.level = 'state' ${hasDesignation ? "AND d.id = ?" : ""}
           LEFT JOIN workers w ON w.id = c.worker_id
          WHERE 1=1 ${notWrong} ${scope.where}
          ORDER BY c.person_name
          LIMIT ${MAX_PEOPLE}`,
        [...(hasDesignation ? [designationId] : []), ...scope.params]
      );
      const byDes = new Map();
      for (const r of rows) {
        if (!allowedDes.has(r.designation_id)) continue;
        if (!byDes.has(r.designation_id)) byDes.set(r.designation_id, []);
        byDes.get(r.designation_id).push({ id: r.contact_id, person_name: r.person_name, photo_url: r.photo_url });
      }
      const groups = [{ id: 0, name: "State", designations: buildDesignations(byDes) }];
      return NextResponse.json({ level, level_designations: levelDesignations, groups });
    }

    // ---- ZONE / LOK SABHA / DISTRICT / ASSEMBLY / BLOCK ----------------------
    const levelIdExpr = LEVEL_ID_EXPR[level];

    // Every location of this level (so empty ones still show "Not Assigned").
    const masterLocs = await query(
      `SELECT id, name FROM locations WHERE type = ? ORDER BY name LIMIT ${MAX_LOCS}`,
      [LOC_TYPE[level]]
    );

    // People holding a designation OF THIS LEVEL, with the location id at this
    // level. Strict join to designations.level = ? — a person only appears for a
    // designation actually mapped to this level.
    const peopleRows = await query(
      `SELECT ${levelIdExpr} AS loc_id, cd.designation_id,
              c.id AS contact_id, c.person_name,
              COALESCE(c.photo_url, w.photo_url) AS photo_url
         FROM contacts c
         JOIN contact_designations cd ON cd.contact_id = c.id
         JOIN designations d ON d.id = cd.designation_id AND d.level = ? ${hasDesignation ? "AND d.id = ?" : ""}
         LEFT JOIN workers w ON w.id = c.worker_id
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations lls ON lls.id = ld.parent_id
         LEFT JOIN locations lz ON lz.id = lls.parent_id
        WHERE 1=1 ${notWrong} ${scope.where}
        ORDER BY c.person_name
        LIMIT ${MAX_PEOPLE}`,
      [level, ...(hasDesignation ? [designationId] : []), ...scope.params]
    );

    const grouped = new Map(); // loc_id → (designation_id → people[])
    for (const r of peopleRows) {
      if (!allowedDes.has(r.designation_id)) continue;
      const loc = r.loc_id ?? 0;
      if (!grouped.has(loc)) grouped.set(loc, new Map());
      const byDes = grouped.get(loc);
      if (!byDes.has(r.designation_id)) byDes.set(r.designation_id, []);
      byDes.get(r.designation_id).push({ id: r.contact_id, person_name: r.person_name, photo_url: r.photo_url });
    }

    // Show EVERY master location of this level (new locations appear here
    // automatically once created). A contact placed with no location at this
    // level lands in an "Unassigned location" group at the end.
    let locs = masterLocs.map((l) => ({ id: l.id, name: l.name }));
    if (grouped.has(0)) locs = [...locs, { id: 0, name: "Unassigned location" }];

    const groups = locs.map((l) => ({ id: l.id, name: l.name, designations: buildDesignations(grouped.get(l.id)) }));

    return NextResponse.json({
      level,
      level_designations: levelDesignations,
      groups,
      capped: peopleRows.length >= MAX_PEOPLE,
    });
  } catch (err) {
    console.error("contacts incomplete (level assignment) error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
