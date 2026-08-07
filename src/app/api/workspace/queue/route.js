import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { resolveActingUserId } from "@/lib/actAs";
import { query } from "@/lib/db";
import { buildRulesOrMatch, zoneMatch, contactsHaveAssignedBy } from "@/lib/assignmentRules";
import { hasWrongNumberColumn, hasFollowUpTimeColumn } from "@/lib/contactExtras";
import { dueClause, laterClause } from "@/lib/followup";
import { buildAssignedFilters } from "@/lib/workspaceFilters";

// Returns:
//   assigned: contacts explicitly assigned to this caller, not yet completed
//   pool_count: how many unassigned, uncompleted contacts are available in caller's home district
//   home_district: { id, name } | null
//   active_lock: a contact currently locked by this caller (if they're mid-call)
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    // A Super Admin can view a specific caller's queue via the Quick Dashboard
    // Switch (they act as that caller). Otherwise oversight roles have no queue.
    const { userId, impersonating } = await resolveActingUserId(session);
    if (isOversight(session) && !impersonating) {
      return NextResponse.json({ message: "Only callers have a workspace queue." }, { status: 403 });
    }

    // Optional search / filters on the assigned queue.
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search");
    const designationId = searchParams.get("designation_id");

    // Load the caller's territory FIRST — the zone is applied automatically.
    const [me] = await query(
      `SELECT u.home_district_id, l.name AS home_district_name,
              u.scope_zone_id, lz.name AS scope_zone_name
         FROM users u
         LEFT JOIN locations l ON l.id = u.home_district_id
         LEFT JOIN locations lz ON lz.id = u.scope_zone_id
        WHERE u.id = ?`,
      [userId]
    );

    // NOTE: contacts EXPLICITLY assigned to this caller always appear regardless
    // of zone — an admin/supervisor deliberately assigned them. The zone
    // restriction applies only to the POOL the caller pulls from (claim/topup).
    //
    // All "Assigned to You" filters (search / geography / designation / Call
    // History) are built by the SHARED helper, so this list and Start Next Call
    // (/api/workspace/claim) apply the exact same conditions.
    const af = buildAssignedFilters({
      search,
      lok_sabha_id: searchParams.get("lok_sabha_id"),
      district_id: searchParams.get("district_id"),
      assembly_id: searchParams.get("assembly_id"),
      designation_id: designationId,
      call_history: searchParams.get("call_history"),
    }, "c");
    const filterSql = af.where;
    const qParams = af.params;

    // Wrong-number contacts belong only in the dedicated list, never the queue —
    // exclude them explicitly (not just via is_completed) so a wrong number that
    // isn't marked completed still can't surface here. Feature-detected.
    const hasWrong = await hasWrongNumberColumn();
    const notWrong = hasWrong ? " AND (c.is_wrong_number = 0 OR c.is_wrong_number IS NULL)" : "";
    // Reminders become due at their date + optional time (feature-detected).
    const hasFupTime = await hasFollowUpTimeColumn();
    const dueSql = dueClause("c", hasFupTime);
    const laterSql = laterClause("c", hasFupTime);

    // Active queue: skip contacts whose follow-up date is still in the future.
    // They reappear on/after the scheduled date.
    // Total due-today assigned matching the filters (uncapped) — so the UI can
    // show the real count instead of being limited by the page size.
    const [{ assigned_total }] = await query(
      `SELECT COUNT(*) AS assigned_total
         FROM contacts c
        WHERE c.assigned_to_user_id = ?
          AND c.is_completed = 0
          AND ${dueSql}${notWrong}${filterSql}`,
      [userId, ...qParams]
    );

    // A contact is a "daily assignment" if it matches one of this caller's
    // active standing rules — those should be worked first. Build the match
    // expression (degrades to "0" / no rules if the feature isn't set up).
    let daily = { sql: "0", params: [] };
    try {
      const rules = await query(
        `SELECT * FROM assignment_rules WHERE caller_user_id = ? AND is_active = 1`,
        [userId]
      );
      if (rules.length) daily = buildRulesOrMatch(rules, "c");
    } catch (e) {
      if (e.code !== "ER_NO_SUCH_TABLE") throw e; // migration not run yet → no daily flag
    }

    // Who assigned each contact (supervisor / super admin) for the caller's
    // "Assigned by" line — only when the column exists (feature-detected).
    const hasAssignedBy = await contactsHaveAssignedBy();
    const assignedBySelect = hasAssignedBy
      ? ", ab.username AS assigned_by_name, ab.role AS assigned_by_role"
      : "";
    const assignedByJoin = hasAssignedBy
      ? "LEFT JOIN users ab ON ab.id = c.assigned_by_user_id"
      : "";

    const assigned = await query(
      `SELECT c.*, ld.name AS district_name, lw.name AS ward_name, w.photo_url AS photo_url,
              (SELECT COUNT(*) FROM calls WHERE contact_id = c.id) AS attempts,
              -- "Worked" = the contact has at least one call with a SAVED call
              -- status or sentiment. This is the exact "not fresh" test: a fresh
              -- contact has neither. (Every call in this schema carries a
              -- status_id, so this also covers callbacks/follow-ups, which are
              -- only ever set through a saved call.)
              (CASE WHEN EXISTS (
                 SELECT 1 FROM calls cx
                  WHERE cx.contact_id = c.id
                    AND (cx.status_id IS NOT NULL OR cx.sentiment IS NOT NULL)
               ) THEN 1 ELSE 0 END) AS is_worked,
              (CASE WHEN (${daily.sql}) THEN 1 ELSE 0 END) AS is_daily${assignedBySelect}
         FROM contacts c
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations lw ON lw.id = c.ward_id
         LEFT JOIN workers w ON w.id = c.worker_id
         ${assignedByJoin}
        WHERE c.assigned_to_user_id = ?
          AND c.is_completed = 0
          AND ${dueSql}${notWrong}${filterSql}
        -- Two ordered sections in ONE query (grouped client-side for headers):
        --   FRESH (is_worked = 0): no saved sentiment and no saved call status —
        --     a brand-new assignment. These lead, newest assigned_at first (legacy
        --     no-timestamp rows last), so callers always work fresh contacts
        --     before anything already touched. A reassignment restamps assigned_at
        --     but NEVER turns a worked contact back into fresh work (its call
        --     history — sentiment/status — is preserved, so is_worked stays 1).
        --   FOLLOW-UP / RECALL (is_worked = 1): anything with a saved sentiment or
        --     call status (incl. callback/follow-up). Sorted by the NEAREST
        --     scheduled follow-up first (date then time), un-dated worked last.
        -- The assigned_at keys are scoped to the fresh group and the follow-up
        -- keys effectively to the worked group, so each section sorts by its own
        -- rule within a single server-side ORDER BY.
        ORDER BY is_worked ASC,
                 (CASE WHEN is_worked = 0 THEN c.assigned_at END) IS NULL ASC,
                 (CASE WHEN is_worked = 0 THEN c.assigned_at END) DESC,
                 c.follow_up_date IS NULL ASC,
                 c.follow_up_date ASC,${hasFupTime ? "\n                 c.follow_up_time IS NULL ASC,\n                 c.follow_up_time ASC," : ""}
                 c.is_vip DESC,
                 c.id DESC
        LIMIT 1000`,
      [...daily.params, userId, ...qParams]
    );

    // Scheduled (future) follow-ups: surfaced so the caller can see what's coming.
    const scheduled = await query(
      `SELECT c.*, ld.name AS district_name
         FROM contacts c
         LEFT JOIN locations ld ON ld.id = c.district_id
        WHERE c.assigned_to_user_id = ?
          AND c.is_completed = 0
          AND ${laterSql}${notWrong}
        -- Kept in sync with the Schedule module: latest schedule_date first,
        -- then newest assignment first among the same date.
        ORDER BY c.follow_up_date DESC${hasFupTime ? ", c.follow_up_time DESC" : ""},
                 c.assigned_at IS NULL ASC, c.assigned_at DESC
        LIMIT 50`,
      [userId]
    );

    // Wrong-number contacts are excluded from the caller's queue (via notWrong
    // above) and are managed only by supervisors/admins in the dedicated Wrong
    // Numbers module — callers no longer see or restore them here.

    const lockedRows = await query(
      `SELECT c.*, ld.name AS district_name, lw.name AS ward_name, w.photo_url AS photo_url
         FROM contacts c
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations lw ON lw.id = c.ward_id
         LEFT JOIN workers w ON w.id = c.worker_id
        WHERE c.locked_by_user_id = ?${notWrong}
        LIMIT 1`,
      [userId]
    );

    // Territory pool: the caller's zone if set, else their home district.
    let poolCount = 0;
    const terr = me?.scope_zone_id
      ? zoneMatch(me.scope_zone_id, "")
      : me?.home_district_id
      ? { where: " AND district_id = ?", params: [me.home_district_id] }
      : null;
    if (terr) {
      const [{ n }] = await query(
        `SELECT COUNT(*) AS n FROM contacts
          WHERE is_completed = 0${hasWrong ? " AND (is_wrong_number = 0 OR is_wrong_number IS NULL)" : ""}
            AND assigned_to_user_id IS NULL
            AND (locked_by_user_id IS NULL OR locked_at < NOW() - INTERVAL 10 MINUTE)
            ${terr.where}`,
        terr.params
      );
      poolCount = n;
    }

    return NextResponse.json({
      assigned,
      assigned_total,
      scheduled,
      pool_count: poolCount,
      // territory label the workspace header shows — zone takes precedence.
      territory: me?.scope_zone_id
        ? { type: "zone", name: me.scope_zone_name }
        : me?.home_district_id
        ? { type: "district", name: me.home_district_name }
        : null,
      home_district: me?.home_district_id ? { id: me.home_district_id, name: me.home_district_name } : null,
      // The caller's zone — used to auto-scope the Lok Sabha filter on the client.
      zone_id: me?.scope_zone_id ?? null,
      zone_name: me?.scope_zone_name ?? null,
      active_lock: lockedRows[0] || null,
    });
  } catch (err) {
    console.error("workspace queue error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
