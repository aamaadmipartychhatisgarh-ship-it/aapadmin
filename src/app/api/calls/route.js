import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { isOversight, scopeFilterSync } from "@/lib/permissions";
import { resolveActingUserId } from "@/lib/actAs";
import { query } from "@/lib/db";
import { hasWrongNumberColumn, hasWrongNumberDetailColumns, hasFollowUpTimeColumn } from "@/lib/contactExtras";
import { emitLiveEvent, LIVE_EVENTS } from "@/lib/liveEvents";

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    // When a Super Admin is previewing a specific caller, show that caller's
    // own calls (My Calls) — resolved server-side, never spoofable.
    const { userId: actingUserId, impersonating } = await resolveActingUserId(session);

    const { searchParams } = new URL(req.url);
    const date_from = searchParams.get("date_from");
    const date_to = searchParams.get("date_to");
    const zone_id = searchParams.get("zone_id");
    const lok_sabha_id = searchParams.get("lok_sabha_id");
    const district_id = searchParams.get("district_id");
    const assembly_id = searchParams.get("assembly_id");
    const status_id = searchParams.get("status_id");
    const designation_id = searchParams.get("designation_id");
    const sentiment = searchParams.get("sentiment");
    const user_id = searchParams.get("user_id");
    const search = searchParams.get("search");

    // Build the WHERE once so the data query and the total count stay identical.
    // Every clause references only c.* columns, so the count needs no joins.
    let where = " WHERE 1=1";
    const params = [];

    // A previewing Super Admin sees the impersonated caller's calls; otherwise
    // supervisors/admins see all calls, and everyone else only their own.
    if (impersonating) {
      where += " AND c.user_id = ?";
      params.push(actingUserId);
    } else if (!isSupervisor(session)) {
      where += " AND c.user_id = ?";
      params.push(session.user.id);
    } else if (user_id) {
      where += " AND c.user_id = ?";
      params.push(user_id);
    }

    if (date_from) { where += " AND DATE(c.called_at) >= ?"; params.push(date_from); }
    if (date_to) { where += " AND DATE(c.called_at) <= ?"; params.push(date_to); }
    if (zone_id) { where += " AND c.zone_id = ?"; params.push(zone_id); }
    if (lok_sabha_id) { where += " AND c.lok_sabha_id = ?"; params.push(lok_sabha_id); }
    if (district_id) { where += " AND c.district_id = ?"; params.push(district_id); }
    if (assembly_id) { where += " AND c.assembly_id = ?"; params.push(assembly_id); }
    // NOTE: the status filter is deliberately NOT part of this base WHERE. It is
    // applied ONLY to the table/list query below, so the summary counts
    // (Total / Picked / Not Picked / Follow-ups / Avg Duration) are computed over
    // the dataset matching every OTHER filter and stay stable no matter which
    // status is selected — picking "Phone Picked" must not make Picked == Total.
    if (designation_id) { where += " AND c.designation_id = ?"; params.push(designation_id); }
    if (sentiment) { where += " AND c.sentiment = ?"; params.push(sentiment); }
    if (search) {
      where += " AND (c.person_name LIKE ? OR c.phone_number LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    // Geographic scope from role (applies to oversight; callers already see only
    // their own). Skipped while impersonating — already filtered to the caller.
    if (isSupervisor(session) && !impersonating) {
      const scope = scopeFilterSync(session.user, "c");
      where += " " + scope.where;
      params.push(...scope.params);
    }

    // --- Summary: computed over the base (no-status) dataset with SQL
    // aggregates, so it is never skewed by the status filter and never capped by
    // the 1000-row display limit. Each call is classified by its ACTUAL stored
    // status (call_statuses.name), never inferred from the selected filter. ---
    const [sum] = await query(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(cs.name = 'Phone Picked'), 0) AS picked,
         COALESCE(SUM(cs.name = 'Not Picked'), 0) AS not_picked,
         COALESCE(SUM(c.is_follow_up_required = 1), 0) AS follow_ups,
         AVG(NULLIF(c.duration_seconds, 0)) AS avg_dur
       FROM calls c
       LEFT JOIN call_statuses cs ON c.status_id = cs.id
       ${where}`,
      params
    );
    const summary = {
      total: Number(sum?.total) || 0,
      picked: Number(sum?.picked) || 0,
      notPicked: Number(sum?.not_picked) || 0,
      followUps: Number(sum?.follow_ups) || 0,
      avgDuration: sum?.avg_dur != null ? Math.round(Number(sum.avg_dur)) : null,
    };

    // The table/list applies the status filter (on top of the base filters) so
    // selecting a status shows only calls whose ACTUAL status matches it.
    let listWhere = where;
    const listParams = [...params];
    if (status_id) { listWhere += " AND c.status_id = ?"; listParams.push(status_id); }

    const sql = `
      SELECT
        c.*,
        u.username as agent_name,
        cs.name as status_name,
        dsg.name as designation_name,
        lz.name as zone_name,
        lls.name as lok_sabha_name,
        ld.name as district_name,
        la.name as assembly_name
      FROM calls c
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN call_statuses cs ON c.status_id = cs.id
      LEFT JOIN designations dsg ON c.designation_id = dsg.id
      LEFT JOIN locations lz ON c.zone_id = lz.id
      LEFT JOIN locations lls ON c.lok_sabha_id = lls.id
      LEFT JOIN locations ld ON c.district_id = ld.id
      LEFT JOIN locations la ON c.assembly_id = la.id
      ${listWhere}
      ORDER BY c.called_at DESC LIMIT 1000`;

    const calls = await query(sql, listParams);
    // Total rows matching the CURRENT view (all filters incl. status), uncapped
    // by the 1000-row display limit — kept for callers that show "N matching".
    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM calls c ${listWhere}`, listParams);
    return Response.json({ calls, total: Number(total) || 0, summary }, { status: 200 });
  } catch (error) {
    console.error("Error fetching calls:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    // Oversight roles don't log calls as themselves — EXCEPT a Super Admin
    // operating a specific caller's dashboard via the Quick Dashboard Switch,
    // whose calls are recorded under that caller.
    const { userId: actingUserId, impersonating } = await resolveActingUserId(session);
    if (isOversight(session) && !impersonating) {
      return Response.json({ message: "Admins and supervisors cannot log calls. Use a caller account." }, { status: 403 });
    }

    const data = await req.json();
    const {
      destination,
      designation_id,
      person_name,
      address,
      phone_number,
      zone_id,
      lok_sabha_id,
      district_id,
      assembly_id,
      ward_id,
      polling_station_id,
      booth_id,
      status_id,
      remarks,
      duration_seconds,
      sentiment,
      is_follow_up_required,
      follow_up_date,
      follow_up_time,
      is_vip,
      contact_id,
    } = data;

    if (!person_name || !phone_number || !status_id) {
      return Response.json({ message: "Name, phone number, and status are required" }, { status: 400 });
    }

    // Resolve the status name up front. Sentiment only applies to a connected
    // ("Phone Picked") call — for every other status we store NULL, never a
    // stale sentiment value.
    const [statusRow] = await query("SELECT name FROM call_statuses WHERE id = ?", [status_id]);
    const statusName = statusRow?.name;
    const finalSentiment = statusName === "Phone Picked" ? (sentiment || null) : null;

    const res = await query(
      `INSERT INTO calls (
        destination, designation_id, person_name, address, phone_number,
        zone_id, lok_sabha_id, district_id, assembly_id, ward_id, polling_station_id, booth_id,
        status_id, remarks, user_id,
        duration_seconds, sentiment, is_follow_up_required, follow_up_date, is_vip,
        contact_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        destination || null,
        designation_id || null,
        person_name,
        address || null,
        phone_number,
        zone_id || null,
        lok_sabha_id || null,
        district_id || null,
        assembly_id || null,
        ward_id || null,
        polling_station_id || null,
        booth_id || null,
        status_id,
        remarks || null,
        actingUserId,
        duration_seconds || null,
        finalSentiment,
        is_follow_up_required ? 1 : 0,
        follow_up_date || null,
        is_vip ? 1 : 0,
        contact_id || null,
      ]
    );

    // Persist the optional exact follow-up time on the call (feature-detected).
    const hasFupTime = await hasFollowUpTimeColumn();
    if (hasFupTime) {
      await query("UPDATE calls SET follow_up_time = ? WHERE id = ?",
        [is_follow_up_required && follow_up_time ? follow_up_time : null, res.insertId]);
    }

    // If the call was tied to a contact: clear the lock, update completion / VIP /
    // follow-up state, and hand the contact back to the caller who scheduled the
    // follow-up so it lands in their queue on the right date.
    let isWrongNumber = false;
    if (contact_id) {
      const finalStatuses = ["Phone Picked", "Wrong Number", "Rudely Behaved"];
      const isFinal = !!statusName && finalStatuses.includes(statusName);
      isWrongNumber = statusName === "Wrong Number";
      // If a follow-up was scheduled, keep the contact open and pin it to this caller.
      const wantsFollowUp = !!is_follow_up_required;
      // Re-logging a call always consumes the previous reminder: set the new
      // follow-up date when one was given, otherwise clear it (so a call-back
      // that logs no new reminder doesn't leave the old future date stuck).
      await query(
        `UPDATE contacts
            SET locked_by_user_id = NULL,
                locked_at = NULL,
                is_completed = CASE WHEN ? AND NOT ? THEN 1 ELSE 0 END,
                follow_up_date = CASE WHEN ? THEN ? ELSE NULL END,
                assigned_to_user_id = CASE WHEN ? THEN ? ELSE assigned_to_user_id END,
                is_vip = CASE WHEN ? THEN 1 ELSE is_vip END
          WHERE id = ?`,
        [
          isFinal ? 1 : 0, wantsFollowUp ? 1 : 0,
          wantsFollowUp ? 1 : 0, follow_up_date || null,
          wantsFollowUp ? 1 : 0, session.user.id,
          is_vip ? 1 : 0,
          contact_id,
        ]
      );

      // Mirror the exact follow-up time onto the contact (set with a new
      // follow-up, cleared otherwise) so the queue can surface it at the right
      // time. Feature-detected.
      if (hasFupTime) {
        await query(
          "UPDATE contacts SET follow_up_time = CASE WHEN ? THEN ? ELSE NULL END WHERE id = ?",
          [wantsFollowUp ? 1 : 0, follow_up_time || null, contact_id]
        );
      }

      // Wrong Number handling: flag the contact so it moves to the dedicated
      // Wrong Number list; any other outcome clears the flag. Only runs once the
      // optional column exists (added by the deploy migration).
      if (await hasWrongNumberColumn()) {
        await query(
          `UPDATE contacts SET is_wrong_number = ? WHERE id = ?`,
          [isWrongNumber ? 1 : 0, contact_id]
        );
        // Record who/when/why — only ON marking (not on clearing), so the
        // detail columns keep the last time this contact WAS flagged as
        // permanent history, even after a later call outcome un-flags it.
        if (isWrongNumber && (await hasWrongNumberDetailColumns())) {
          await query(
            `UPDATE contacts
                SET wrong_number_reason = ?, wrong_number_notes = ?, wrong_number_at = NOW(),
                    wrong_number_by = ?, wrong_number_call_id = ?
              WHERE id = ?`,
            [data.wrong_number_reason || null, remarks || null, session.user.id, res.insertId, contact_id]
          );
        }
      }
    }

    emitLiveEvent(LIVE_EVENTS.CALL_LOGGED, { call_id: res.insertId, contact_id: contact_id || null, status: statusName, user_id: session.user.id });
    if (isWrongNumber) emitLiveEvent(LIVE_EVENTS.WRONG_NUMBER_ADDED, { contact_id, call_id: res.insertId });

    return Response.json({ message: "Call logged successfully", id: res.insertId }, { status: 201 });
  } catch (error) {
    console.error("Error logging call:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
