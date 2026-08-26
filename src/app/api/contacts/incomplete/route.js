import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, scopeFilterSync } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { notWrongNumberClause } from "@/lib/contactExtras";
import { ensureContactDesignationsSchema } from "@/lib/contactDesignations";

export const dynamic = "force-dynamic";

// CONTACTS → INCOMPLETE DESIGNATION — a database-driven filtered VIEW of the
// existing contacts (no copy table). One field is chosen ("Incomplete Data By"),
// a status (Blank / Fill), and optionally a Designation from the master; the API
// returns the matching MEMBERS (name + photo only). All filtering is at the DB
// level so it stays fast on large tables.

const idList = (raw) =>
  raw ? [...new Set(String(raw).split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0))] : [];

// The resolvable value of each selectable field. Zone / Lok Sabha resolve from
// the contact's own column OR the district hierarchy (district → lok_sabha →
// zone). "state" resolves when the contact has ANY location at all (the app is
// single-state, so a contact is "in the state" once it's placed anywhere; it's
// blank only when fully unplaced). NULL = blank, non-NULL = filled.
const FIELD_EXPR = {
  zone: "COALESCE(c.zone_id, lz.id)",
  lok_sabha: "COALESCE(c.lok_sabha_id, lls.id)",
  district: "ld.id",
  assembly: "la.id", // Vidhan Sabha
  state: "COALESCE(c.zone_id, lz.id, c.lok_sabha_id, lls.id, ld.id, la.id)",
};

const JOINS = `
   LEFT JOIN workers w ON w.id = c.worker_id
   LEFT JOIN locations ld ON ld.id = c.district_id
   LEFT JOIN locations lls ON lls.id = ld.parent_id
   LEFT JOIN locations lz ON lz.id = lls.parent_id
   LEFT JOIN locations la ON la.id = c.assembly_id`;

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "contacts", session && isAdmin(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    await ensureContactDesignationsSchema();

    const { searchParams } = new URL(req.url);
    const field = String(searchParams.get("field") || "zone").toLowerCase();
    const expr = FIELD_EXPR[field];
    if (!expr) return NextResponse.json({ message: "Invalid field." }, { status: 400 });
    const status = String(searchParams.get("status") || "blank").toLowerCase() === "fill" ? "fill" : "blank";
    const designation_ids = idList(searchParams.get("designation_ids") || searchParams.get("designation_id"));
    const page = Math.max(1, parseInt(searchParams.get("page"), 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("page_size"), 10) || 60));
    const offset = (page - 1) * pageSize;

    const notWrong = await notWrongNumberClause("c");
    const scope = scopeFilterSync(session.user, "c");

    let where = ` WHERE 1=1 ${notWrong} ${scope.where}`;
    const params = [...scope.params];
    // The chosen field's Blank / Fill condition.
    where += status === "blank" ? ` AND ${expr} IS NULL` : ` AND ${expr} IS NOT NULL`;
    // Optional Designation (master) filter — the contact's own designation set
    // (multi) or the legacy single id.
    if (designation_ids.length) {
      const ph = designation_ids.map(() => "?").join(",");
      where += ` AND (c.designation_id IN (${ph}) OR EXISTS (SELECT 1 FROM contact_designations cd WHERE cd.contact_id = c.id AND cd.designation_id IN (${ph})))`;
      params.push(...designation_ids, ...designation_ids);
    }

    const [cnt] = await query(`SELECT COUNT(*) AS total FROM contacts c ${JOINS} ${where}`, params);
    const total = Number(cnt?.total || 0);

    // Members — NAME + PHOTO only (no other contact fields exposed).
    const members = await query(
      `SELECT c.id, c.person_name, COALESCE(c.photo_url, w.photo_url) AS photo_url
         FROM contacts c ${JOINS} ${where}
        ORDER BY c.person_name ASC, c.id ASC
        LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    return NextResponse.json({ members, total, page, page_size: pageSize });
  } catch (err) {
    console.error("contacts incomplete GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
