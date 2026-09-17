import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { scopeFilterSync } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { DESIGNATION_NAMES_SQL } from "@/lib/contactDesignations";
import { repeatOffSelect, REPEAT_OFF_THRESHOLD } from "@/lib/repeatOff";

// GET /api/contacts/repeat-off?type=switched|incoming
// Contacts dispositioned that status MORE THAN 10 times, derived live from call
// records. Same permission (pageAllowed "contacts") and role/territory scope as
// the Contacts list, so nobody sees contacts they aren't authorized to.
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "contacts", session && isSupervisor(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") === "incoming" ? "incoming" : "switched";
    const search = (searchParams.get("search") || "").trim();
    const page = Math.max(1, parseInt(searchParams.get("page"), 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("page_size"), 10) || 50));
    const offset = (page - 1) * pageSize;

    const sel = await repeatOffSelect(type, "c");
    let where = " WHERE 1=1" + sel.where;
    const params = [];
    if (search) { where += " AND (c.person_name LIKE ? OR c.phone_number LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }
    const scope = scopeFilterSync(session.user, "c");
    where += " " + scope.where;
    params.push(...scope.params);

    const workerJoin = "LEFT JOIN workers w ON w.id = c.worker_id";
    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM contacts c ${workerJoin} ${where}`, params);
    const contacts = await query(
      `SELECT c.id, c.person_name, c.phone_number, c.is_completed,
              u.username AS assigned_to_username,
              ld.name AS district_name, la.name AS assembly_name,
              COALESCE(${DESIGNATION_NAMES_SQL}, NULLIF(TRIM(w.position), ''), dsg.name) AS designation_name,
              COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) AS photo_url,
              ${sel.countExpr} AS off_count
         FROM contacts c
         ${workerJoin}
         LEFT JOIN users u ON u.id = c.assigned_to_user_id
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations la ON la.id = c.assembly_id
         LEFT JOIN designations dsg ON dsg.id = c.designation_id
         ${where}
        ORDER BY off_count DESC, c.id DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    const totalPages = Math.max(1, Math.ceil(Number(total) / pageSize));
    return NextResponse.json(
      { contacts, total: Number(total) || 0, page, page_size: pageSize, totalPages, type, threshold: REPEAT_OFF_THRESHOLD },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("repeat-off GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
