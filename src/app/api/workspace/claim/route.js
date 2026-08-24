import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { resolveActingUserId } from "@/lib/actAs";
import { getPool } from "@/lib/db";
import { zoneMatch } from "@/lib/assignmentRules";
import { hasWrongNumberColumn, hasFollowUpTimeColumn } from "@/lib/contactExtras";
import { dueClause } from "@/lib/followup";
import { buildAssignedFilters } from "@/lib/workspaceFilters";

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
    // The caller's active "Assigned to You" filters travel with Start Next Call
    // so it opens the NEXT contact from the SAME filtered dataset the caller sees
    // — never a random/unfiltered one. Same builder the queue list uses.
    const af = buildAssignedFilters(body.filters || {}, "contacts");

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
        // Auto-advance serves work in three tiers, and NEVER modifies any
        // contact's call history / sentiment / status / recall / follow-up — it
        // only chooses which existing row to open next.
        //
        //   TIER 1 — FRESH assignments: contacts assigned to this caller with
        //   zero call activity (no call record → therefore no sentiment,
        //   disposition, remark, callback or completed call). Ordered exactly
        //   like My Workspace (newest assigned_at first, no-timestamp last, VIP
        //   ahead, id tie-breaker) so "next" walks the visible fresh list in
        //   sequence, one contact per click.
        //
        //   TIER 2 — EXISTING WORKFLOW: only once the fresh queue is exhausted do
        //   we fall back to the caller's remaining DUE assigned contacts (recall
        //   schedules, scheduled call-backs, follow-ups) in the original priority
        //   order. Their history stays fully intact — they're simply reached
        //   after fresh work, not before it.
        //
        //   TIER 3 — POOL: finally, an unclaimed territory contact.
        // FRESH = no saved call status and no saved sentiment on any call. A
        // worked contact (any status/sentiment, incl. callback/follow-up) is
        // never auto-served here — it stays in the recall/follow-up workflow.
        const freshOnly = "AND NOT EXISTS (SELECT 1 FROM calls cx WHERE cx.contact_id = contacts.id AND (cx.status_id IS NOT NULL OR cx.sentiment IS NOT NULL))";
        const [freshRows] = await conn.execute(
          `SELECT * FROM contacts
            WHERE is_completed = 0${notWrong}
              AND assigned_to_user_id = ?
              AND ${dueSql}
              ${freshOnly}
              AND (locked_by_user_id IS NULL OR locked_at < NOW() - INTERVAL 10 MINUTE)
              ${assignedTerr.where}${af.where}
            ORDER BY assigned_at IS NULL ASC, assigned_at DESC, is_vip DESC, id DESC
            LIMIT 1 FOR UPDATE`,
          [userId, ...assignedTerr.params, ...af.params]
        );
        if (freshRows[0]) {
          row = freshRows[0];
        } else {
          // TIER 2: existing workflow for already-worked, still-due contacts —
          // ordered to match the My Workspace follow-up section (nearest first).
          const [assignedRows] = await conn.execute(
            `SELECT * FROM contacts
              WHERE is_completed = 0${notWrong}
                AND assigned_to_user_id = ?
                AND ${dueSql}
                AND (locked_by_user_id IS NULL OR locked_at < NOW() - INTERVAL 10 MINUTE)
                ${assignedTerr.where}${af.where}
              ORDER BY follow_up_date IS NULL ASC, follow_up_date ASC, is_vip DESC, id DESC
              LIMIT 1 FOR UPDATE`,
            [userId, ...assignedTerr.params, ...af.params]
          );
          if (assignedRows[0]) {
            row = assignedRows[0];
          } else if (!af.active) {
            // TIER 3: territory pool fallback — ONLY when no filter is active.
            // With an active filter, Start Next Call must never leave the
            // caller's filtered "Assigned to You" dataset (no random/pool pick).
            const [poolRows] = await conn.execute(
              `SELECT * FROM contacts
                WHERE is_completed = 0${notWrong}
                  AND assigned_to_user_id IS NULL
                  AND ${dueSql}
                  AND (locked_by_user_id IS NULL OR locked_at < NOW() - INTERVAL 10 MINUTE)
                  ${terr.where}
                ORDER BY id ASC
                LIMIT 1 FOR UPDATE`,
              terr.params
            );
            row = poolRows[0];
          }
        }
      }

      if (!row) {
        await conn.rollback();
        // Nothing available. With an active filter this means the filtered list
        // is exhausted (never fall back to a random/unfiltered contact); with no
        // filter, the caller is fully caught up across all tiers.
        const message = explicitId
          ? "That contact is no longer available."
          : af.active
          ? "No more contacts available for the selected filters."
          : "No calls are available right now — you're all caught up.";
        return NextResponse.json({ message }, { status: 409 });
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
          // Canonical source of truth: the contact's OWN photo first, the linked
          // worker's photo only as a fallback (same resolution the Contacts list
          // uses), so every caller sees the identical photo for a given contact.
          photo_url: row.photo_url ?? nameRows[0]?.photo_url ?? null,
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
