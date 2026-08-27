import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/number-corrections?status=pending&mine=1
// Two audiences share this list:
//   - Oversight (admin/supervisor): the full Number Corrections center —
//     every request, any status, for verifying/rejecting/resolving.
//   - Anyone else: only with `mine=1` — requests already verified and routed
//     to a Designation THEY hold (resolved live via workers.position + a
//     linked login, same as the notification fan-out), so a designation
//     holder can see their own correction tasks without needing admin rights.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const mine = searchParams.get("mine") === "1";
    // The full corrections center is for oversight OR a user granted the Number
    // Corrections page (managed override); everyone else only with mine=1.
    const oversight = isOversight(session) || (await pageAllowed(session, "number_corrections", false));

    if (!oversight && !mine) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const where = [];
    const params = [];
    if (status) { where.push("r.status = ?"); params.push(status); }

    if (mine && !oversight) {
      // Only requests verified (target_designation_id set) AND still actionable
      // (pending), narrowed to designations this user actually holds.
      const rows = await query(`SELECT w.position FROM workers w WHERE w.user_id = ?`, [session.user.id]);
      const heldDesignationIds = new Set();
      if (rows.length) {
        const desRows = await query("SELECT id, name FROM designations");
        const positions = rows.map((r) => String(r.position || "").split(",").map((s) => s.trim()));
        for (const d of desRows) {
          if (positions.some((p) => p.includes(d.name))) heldDesignationIds.add(d.id);
        }
      }
      if (heldDesignationIds.size === 0) return NextResponse.json({ requests: [] });
      where.push(`r.target_designation_id IN (${[...heldDesignationIds].map(() => "?").join(",")})`);
      params.push(...heldDesignationIds);
      where.push("r.status = 'pending'");
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const requests = await query(
      `SELECT r.*, c.person_name, c.phone_number AS current_phone_number,
              rb.username AS reported_by_username,
              vb.username AS verified_by_username,
              cb.username AS corrected_by_username,
              rjb.username AS rejected_by_username,
              rsb.username AS resolved_by_username,
              d.name AS target_designation_name
         FROM number_correction_requests r
         JOIN contacts c ON c.id = r.contact_id
         LEFT JOIN users rb ON rb.id = r.reported_by_user_id
         LEFT JOIN users vb ON vb.id = r.verified_by_user_id
         LEFT JOIN users cb ON cb.id = r.corrected_by_user_id
         LEFT JOIN users rjb ON rjb.id = r.rejected_by_user_id
         LEFT JOIN users rsb ON rsb.id = r.resolved_by_user_id
         LEFT JOIN designations d ON d.id = r.target_designation_id
         ${whereSql}
        ORDER BY r.reported_at DESC
        LIMIT 500`,
      params
    );
    return NextResponse.json({ requests });
  } catch (err) {
    console.error("number-corrections GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
