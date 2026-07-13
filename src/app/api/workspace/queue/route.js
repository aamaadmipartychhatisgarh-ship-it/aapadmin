import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";
import { buildRulesOrMatch, zoneMatch } from "@/lib/assignmentRules";

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
    // Admins/supervisors don't have a calling queue.
    if (isOversight(session)) {
      return NextResponse.json({ message: "Only callers have a workspace queue." }, { status: 403 });
    }
    const userId = session.user.id;

    // Optional search / filters on the assigned queue.
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search");
    const districtId = searchParams.get("district_id");
    const designationId = searchParams.get("designation_id");
    const qFilters = [];
    const qParams = [];
    if (search) { qFilters.push("(c.person_name LIKE ? OR c.phone_number LIKE ?)"); qParams.push(`%${search}%`, `%${search}%`); }
    if (districtId) { qFilters.push("c.district_id = ?"); qParams.push(districtId); }
    if (designationId) { qFilters.push("c.designation_id = ?"); qParams.push(designationId); }
    const filterSql = qFilters.length ? " AND " + qFilters.join(" AND ") : "";

    const [me] = await query(
      `SELECT u.home_district_id, l.name AS home_district_name,
              u.scope_zone_id, lz.name AS scope_zone_name
         FROM users u
         LEFT JOIN locations l ON l.id = u.home_district_id
         LEFT JOIN locations lz ON lz.id = u.scope_zone_id
        WHERE u.id = ?`,
      [userId]
    );

    // Active queue: skip contacts whose follow-up date is still in the future.
    // They reappear on/after the scheduled date.
    // Total due-today assigned matching the filters (uncapped) — so the UI can
    // show the real count instead of being limited by the page size.
    const [{ assigned_total }] = await query(
      `SELECT COUNT(*) AS assigned_total
         FROM contacts c
        WHERE c.assigned_to_user_id = ?
          AND c.is_completed = 0
          AND (c.follow_up_date IS NULL OR c.follow_up_date <= CURDATE())${filterSql}`,
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

    const assigned = await query(
      `SELECT c.*, ld.name AS district_name, lw.name AS ward_name,
              (SELECT COUNT(*) FROM calls WHERE contact_id = c.id) AS attempts,
              (CASE WHEN (${daily.sql}) THEN 1 ELSE 0 END) AS is_daily
         FROM contacts c
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations lw ON lw.id = c.ward_id
        WHERE c.assigned_to_user_id = ?
          AND c.is_completed = 0
          AND (c.follow_up_date IS NULL OR c.follow_up_date <= CURDATE())${filterSql}
        ORDER BY (CASE WHEN (${daily.sql}) THEN 0 ELSE 1 END) ASC,
                 c.is_vip DESC,
                 c.follow_up_date IS NOT NULL DESC,
                 c.follow_up_date ASC,
                 c.id ASC
        LIMIT 1000`,
      [...daily.params, userId, ...qParams, ...daily.params]
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
          WHERE is_completed = 0
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
      active_lock: lockedRows[0] || null,
    });
  } catch (err) {
    console.error("workspace queue error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
