import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { ensureUnfilteredAssignmentSchema } from "@/lib/unfilteredContacts";

const NO_STORE = { "Cache-Control": "no-store" };

// Unfiltered Contact list (read-only) + recent import batches. Separate table
// from Contacts; ?q= searches name / phone, ?page= / ?pageSize= paginate.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "unfiltered_contacts", session && isAdmin(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    await ensureUnfilteredAssignmentSchema();
    const { searchParams } = new URL(req.url);
    const q = String(searchParams.get("q") || "").trim();
    const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("pageSize")) || 50));
    const page = Math.max(1, Number(searchParams.get("page")) || 1);

    const where = [];
    const params = [];
    if (q) {
      const digits = q.replace(/\D/g, "");
      where.push(digits.length >= 3 ? "(u.person_name LIKE ? OR u.phone_key LIKE ?)" : "u.person_name LIKE ?");
      params.push(`%${q}%`);
      if (digits.length >= 3) params.push(`%${digits.slice(-10)}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [{ n }] = await query(`SELECT COUNT(*) AS n FROM unfiltered_contacts u ${whereSql}`, params);
    const rows = await query(
      `SELECT u.id, u.person_name, u.phone_number, u.phone_key, u.address, u.designation, u.created_at,
              COALESCE(ld.name, u.district_name) AS district, COALESCE(la.name, u.assembly_name) AS assembly,
              b.file_name, au.username AS assigned_to, u.assigned_to_user_id, u.completed_at, u.call_status_name
         FROM unfiltered_contacts u
         LEFT JOIN users au ON au.id = u.assigned_to_user_id
         LEFT JOIN locations ld ON ld.id = u.district_id
         LEFT JOIN locations la ON la.id = u.assembly_id
         LEFT JOIN unfiltered_import_batches b ON b.id = u.import_batch_id
         ${whereSql}
        ORDER BY u.id DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params
    );
    const [{ n: assignedN }] = await query(`SELECT COUNT(*) AS n FROM unfiltered_contacts u ${whereSql ? `${whereSql} AND` : "WHERE"} u.assigned_to_user_id IS NOT NULL`, params);
    const [{ all }] = await query("SELECT COUNT(*) AS `all` FROM unfiltered_contacts");
    const batches = await query(
      `SELECT b.id, b.file_name, b.total_rows, b.imported, b.duplicates, b.invalid, b.created_at, us.username AS imported_by
         FROM unfiltered_import_batches b LEFT JOIN users us ON us.id = b.imported_by
        ORDER BY b.id DESC LIMIT 10`
    );
    return NextResponse.json({ contacts: rows, total: Number(n), all_total: Number(all), assigned_total: Number(assignedN), page, pageSize, batches }, { headers: NO_STORE });
  } catch (err) {
    console.error("unfiltered-contacts GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
