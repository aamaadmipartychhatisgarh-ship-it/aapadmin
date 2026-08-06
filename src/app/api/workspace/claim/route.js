import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { resolveActingUserId } from "@/lib/actAs";
import { getPool } from "@/lib/db";
import { zoneMatch } from "@/lib/assignmentRules";
import { hasWrongNumberColumn, hasFollowUpTimeColumn } from "@/lib/contactExtras";
import { dueClause } from "@/lib/followup";

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
    const { userId, impersonating } = await resolveActingUserId(session);
    if (isOversight(session) && !impersonating) {
      return NextResponse.json({ message: "Only callers can claim contacts." }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const explicitId = body.contact_id;

    // Wrong-number contacts must never be claimable from the queue — they live in
    // their own list until restored. Feature-detected so it's a no-op pre-migration.
    const notWrong = (await hasWrongNumberColumn())
      ? " AND (is_wrong_number = 0 OR is_wrong_number IS NULL)" : "";
    // A reminder is due at its date + optional time (feature-detected).
    const dueSql = dueClause("", await hasFollowUpTimeColumn());

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
                       AND ${dueSql}))
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
        // Explicit assignments are NOT zone-restricted: a contact assigned to
        // this caller is always claimable by them (mirrors the Assigned-to-You
        // list). The zone restriction applies only to the pool fallback (terr).
        const assignedTerr = { where: "", params: [] };
        // "Start Next Call" only ever serves a FRESH, never-worked contact: one
        // with zero call activity (no call record → no sentiment, no
        // disposition/outcome, no call remarks, no completed call). A contact
        // that's already been worked — including a due call-back, Busy or
        // Follow-up — is NOT auto-served here; the caller re-opens those by
        // tapping them in the list (the explicit-id branch above allows that).
        // This keeps auto-advance flowing through brand-new work in order.
        const freshOnly = "AND NOT EXISTS (SELECT 1 FROM calls cx WHERE cx.contact_id = contacts.id)";
        // Ordered identically to My Workspace so "next" is exactly the top of the
        // caller's visible fresh list: newest assignment first (assigned_at),
        // rows with no timestamp last, VIPs ahead, id as the final tie-breaker.
        const freshOrder = "ORDER BY assigned_at IS NULL ASC, assigned_at DESC, is_vip DESC, id DESC";
        // Try caller's own assigned FRESH queue first, then fall back to the territory pool.
        const [assignedRows] = await conn.execute(
          `SELECT * FROM contacts
            WHERE is_completed = 0${notWrong}
              AND assigned_to_user_id = ?
              AND ${dueSql}
              ${freshOnly}
              AND (locked_by_user_id IS NULL OR locked_at < NOW() - INTERVAL 10 MINUTE)
              ${assignedTerr.where}
            ${freshOrder}
            LIMIT 1 FOR UPDATE`,
          [userId, ...assignedTerr.params]
        );
        if (assignedRows[0]) {
          row = assignedRows[0];
        } else {
          const [poolRows] = await conn.execute(
            `SELECT * FROM contacts
              WHERE is_completed = 0${notWrong}
                AND assigned_to_user_id IS NULL
                AND ${dueSql}
                ${freshOnly}
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
        // No fresh, never-worked contact left to auto-serve. Worked contacts
        // (call-backs, follow-ups) may still be in the list for the caller to
        // re-open manually — this only means auto-advance has nothing new.
        return NextResponse.json(
          { message: explicitId ? "That contact is no longer available." : "No new calls are available. All assigned fresh contacts have been completed." },
          { status: 409 }
        );
      }

      await conn.execute(
        `UPDATE contacts SET locked_by_user_id = ?, locked_at = NOW() WHERE id = ?`,
        [userId, row.id]
      );
      // Resolve district + block/ward names and the linked worker's photo so the
      // active call card and edit form can show them.
      const [nameRows] = await conn.execute(
        `SELECT (SELECT name FROM locations WHERE id = ?) AS ward_name,
                (SELECT name FROM locations WHERE id = ?) AS district_name,
                (SELECT photo_url FROM workers WHERE id = ?) AS photo_url`,
        [row.ward_id ?? null, row.district_id ?? null, row.worker_id ?? null]
      );
      await conn.commit();
      return NextResponse.json({
        contact: {
          ...row,
          ward_name: nameRows[0]?.ward_name ?? null,
          district_name: nameRows[0]?.district_name ?? null,
          photo_url: nameRows[0]?.photo_url ?? null,
          locked_by_user_id: userId,
        },
      });
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
