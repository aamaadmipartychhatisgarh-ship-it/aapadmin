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
const MAX_PEOPLE = 4000; // safety cap for one view

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

    let where = " WHERE 1=1";
    const params = [];
    where += await notWrongNumberClause("c");
    // Only people who hold the chosen designation (own single OR the multi set).
    if (hasDesignation) {
      where += ` AND (c.designation_id = ? OR EXISTS (SELECT 1 FROM contact_designations cd WHERE cd.contact_id = c.id AND cd.designation_id = ?))`;
      params.push(designationId, designationId);
    }
    // Role geo scope — same as the Contacts list, so a supervisor only sees their
    // territory, admins see all.
    const scope = scopeFilterSync(session.user, "c");
    where += " " + scope.where;
    params.push(...scope.params);

    const rows = await query(
      `SELECT c.id, c.person_name, c.phone_number, c.address,
              ${groupExpr} AS group_name,
              COALESCE(${DESIGNATION_NAMES_SQL}, NULLIF(TRIM(w.position), ''), dsg.name) AS designations,
              COALESCE(c.photo_url, w.photo_url) AS photo_url
         FROM contacts c
         LEFT JOIN workers w ON w.id = c.worker_id
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations lls ON lls.id = ld.parent_id
         LEFT JOIN locations lz ON lz.id = lls.parent_id
         LEFT JOIN locations cz ON cz.id = c.zone_id
         LEFT JOIN locations cls ON cls.id = c.lok_sabha_id
         LEFT JOIN locations la ON la.id = c.assembly_id
         LEFT JOIN locations lw ON lw.id = c.ward_id
         LEFT JOIN designations dsg ON dsg.id = c.designation_id
        ${where}
        ORDER BY group_name IS NULL, group_name, c.person_name
        LIMIT ${MAX_PEOPLE + 1}`,
      params
    );

    const capped = rows.length > MAX_PEOPLE;
    const people = capped ? rows.slice(0, MAX_PEOPLE) : rows;

    // Group by the resolved level name (JS keeps the query simple + returns the
    // people arrays the UI needs).
    const map = new Map();
    for (const r of people) {
      const name = r.group_name || "Unassigned";
      if (!map.has(name)) map.set(name, []);
      map.get(name).push({
        id: r.id,
        person_name: r.person_name,
        phone_number: r.phone_number,
        address: r.address,
        designations: r.designations,
        photo_url: r.photo_url,
      });
    }
    const groups = [...map.entries()]
      .map(([name, ppl]) => ({ name, count: ppl.length, people: ppl }))
      .sort((a, b) => (a.name === "Unassigned" ? 1 : b.name === "Unassigned" ? -1 : a.name.localeCompare(b.name)));

    return NextResponse.json({
      level,
      total: people.length,
      groups,
      capped,
    });
  } catch (err) {
    console.error("contacts hierarchy error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
