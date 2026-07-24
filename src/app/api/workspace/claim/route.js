import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { getPool } from "@/lib/db";
import { zoneMatch } from "@/lib/assignmentRules";
import { hasWrongNumberColumn } from "@/lib/contactExtras";

// Body: { contact_id?: number }
// If contact_id given: claim that specific contact (must be assigned to user OR in pool with same district).
// If omitted: claim the next available contact from caller's home_district pool.
// Returns the claimed contact, or 409 if nothing available.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (isOversight(session)) {
      return NextResponse.json({ message: "Only callers can claim contacts." }, { status: 403 });
    }
    const userId = session.user.id;
    const body = await req.json().catch(() => ({}));
    const explicitId = body.contact_id;

    // Wrong-number contacts must never be claimable from the queue — they live in
    // their own list until restored. Feature-detected so it's a no-op pre-migration.
    const notWrong = (await hasWrongNumberColumn())
      ? " AND (is_wrong_number = 0 OR is_wrong_number IS NULL)" : "";

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Release any stale lock the caller might still hold
      await conn.execute(
        `UPDATE contacts SET locked_by_user_id = NULL, locked_at = NULL
          WHERE locked_by_user_id = ? AND locked_at < NOW() - INTERVAL 10 MINUTE`,
        [userId]
      );

      let row;
      if (explicitId) {
        // A caller can re-open a contact assigned to them at any time — including
        // one with a future-dated follow-up reminder (so a same-day call-back
        // works). Pool contacts still respect the due-date and lock rules.
        const [rows] = await conn.execute(
          `SELECT * FROM contacts WHERE id = ?
             AND is_completed = 0${notWrong}
             AND (locked_by_user_id IS NULL OR locked_by_user_id = ? OR locked_at < NOW() - INTERVAL 10 MINUTE)
             AND (assigned_to_user_id = ?
                  OR (assigned_to_user_id IS NULL
                       AND (follow_up_date IS NULL OR follow_up_date <= CURDATE())))
           FOR UPDATE`,
          [explicitId, userId, userId]
        );
        row = rows[0];
      } else {
        const [[me]] = await conn.execute(`SELECT home_district_id, scope_zone_id FROM users WHERE id = ?`, [userId]);
        if (!me?.home_district_id && !me?.scope_zone_id) {
          await conn.rollback();
          return NextResponse.json({ message: "No territory set. Ask an admin to assign a zone." }, { status: 400 });
        }
        // Territory: the caller's zone if set, otherwise their home district.
        const terr = me.scope_zone_id
          ? zoneMatch(me.scope_zone_id, "")
          : { where: " AND district_id = ?", params: [me.home_district_id] };
        // Try caller's own assigned queue first (incl. due follow-ups), then fall back to the territory pool.
        const [assignedRows] = await conn.execute(
          `SELECT * FROM contacts
            WHERE is_completed = 0${notWrong}
              AND assigned_to_user_id = ?
              AND (follow_up_date IS NULL OR follow_up_date <= CURDATE())
              AND (locked_by_user_id IS NULL OR locked_at < NOW() - INTERVAL 10 MINUTE)
            ORDER BY is_vip DESC, follow_up_date IS NOT NULL DESC, follow_up_date ASC, id ASC
            LIMIT 1 FOR UPDATE`,
          [userId]
        );
        if (assignedRows[0]) {
          row = assignedRows[0];
        } else {
          const [poolRows] = await conn.execute(
            `SELECT * FROM contacts
              WHERE is_completed = 0${notWrong}
                AND assigned_to_user_id IS NULL
                AND (follow_up_date IS NULL OR follow_up_date <= CURDATE())
                AND (locked_by_user_id IS NULL OR locked_at < NOW() - INTERVAL 10 MINUTE)
                ${terr.where}
              ORDER BY id ASC
              LIMIT 1 FOR UPDATE`,
            terr.params
          );
          row = poolRows[0];
        }
      }

      if (!row) {
        await conn.rollback();
        return NextResponse.json({ message: "No contacts available" }, { status: 409 });
      }

      await conn.execute(
        `UPDATE contacts SET locked_by_user_id = ?, locked_at = NOW() WHERE id = ?`,
        [userId, row.id]
      );
      await conn.commit();
      return NextResponse.json({ contact: { ...row, locked_by_user_id: userId } });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error("workspace claim error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
