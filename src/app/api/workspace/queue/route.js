import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";

// Returns:
//   assigned: contacts explicitly assigned to this caller, not yet completed
//   pool_count: how many unassigned, uncompleted contacts are available in caller's home district
//   home_district: { id, name } | null
//   active_lock: a contact currently locked by this caller (if they're mid-call)
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    // Admins/supervisors don't have a calling queue.
    if (isOversight(session)) {
      return NextResponse.json({ message: "Only callers have a workspace queue." }, { status: 403 });
    }
    const userId = session.user.id;

    const [me] = await query(
      `SELECT u.home_district_id, l.name AS home_district_name
         FROM users u
         LEFT JOIN locations l ON l.id = u.home_district_id
        WHERE u.id = ?`,
      [userId]
    );

    // Active queue: skip contacts whose follow-up date is still in the future.
    // They reappear on/after the scheduled date.
    const assigned = await query(
      `SELECT c.*, ld.name AS district_name, lw.name AS ward_name,
              (SELECT COUNT(*) FROM calls WHERE contact_id = c.id) AS attempts
         FROM contacts c
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations lw ON lw.id = c.ward_id
        WHERE c.assigned_to_user_id = ?
          AND c.is_completed = 0
          AND (c.follow_up_date IS NULL OR c.follow_up_date <= CURDATE())
        ORDER BY c.is_vip DESC,
                 c.follow_up_date IS NOT NULL DESC,
                 c.follow_up_date ASC,
                 c.id ASC
        LIMIT 200`,
      [userId]
    );

    // Scheduled (future) follow-ups: surfaced so the caller can see what's coming.
    const scheduled = await query(
      `SELECT c.*, ld.name AS district_name
         FROM contacts c
         LEFT JOIN locations ld ON ld.id = c.district_id
        WHERE c.assigned_to_user_id = ?
          AND c.is_completed = 0
          AND c.follow_up_date IS NOT NULL
          AND c.follow_up_date > CURDATE()
        ORDER BY c.follow_up_date ASC
        LIMIT 50`,
      [userId]
    );

    const lockedRows = await query(
      `SELECT c.*, ld.name AS district_name, lw.name AS ward_name
         FROM contacts c
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations lw ON lw.id = c.ward_id
        WHERE c.locked_by_user_id = ?
        LIMIT 1`,
      [userId]
    );

    let poolCount = 0;
    if (me?.home_district_id) {
      const [{ n }] = await query(
        `SELECT COUNT(*) AS n FROM contacts
          WHERE is_completed = 0
            AND assigned_to_user_id IS NULL
            AND (locked_by_user_id IS NULL OR locked_at < NOW() - INTERVAL 10 MINUTE)
            AND district_id = ?`,
        [me.home_district_id]
      );
      poolCount = n;
    }

    return NextResponse.json({
      assigned,
      scheduled,
      pool_count: poolCount,
      home_district: me?.home_district_id ? { id: me.home_district_id, name: me.home_district_name } : null,
      active_lock: lockedRows[0] || null,
    });
  } catch (err) {
    console.error("workspace queue error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
