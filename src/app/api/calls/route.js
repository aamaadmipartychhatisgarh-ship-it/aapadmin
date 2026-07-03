import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { isOversight, scopeFilterSync } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const date_from = searchParams.get("date_from");
    const date_to = searchParams.get("date_to");
    const zone_id = searchParams.get("zone_id");
    const district_id = searchParams.get("district_id");
    const status_id = searchParams.get("status_id");
    const designation_id = searchParams.get("designation_id");
    const sentiment = searchParams.get("sentiment");
    const user_id = searchParams.get("user_id");
    const search = searchParams.get("search");

    let sql = `
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
      WHERE 1=1
    `;
    const params = [];

    // Supervisors/admins see all calls; everyone else sees only their own
    if (!isSupervisor(session)) {
      sql += " AND c.user_id = ?";
      params.push(session.user.id);
    } else if (user_id) {
      sql += " AND c.user_id = ?";
      params.push(user_id);
    }

    if (date_from) {
      sql += " AND DATE(c.called_at) >= ?";
      params.push(date_from);
    }
    if (date_to) {
      sql += " AND DATE(c.called_at) <= ?";
      params.push(date_to);
    }
    if (zone_id) {
      sql += " AND c.zone_id = ?";
      params.push(zone_id);
    }
    if (district_id) {
      sql += " AND c.district_id = ?";
      params.push(district_id);
    }
    if (status_id) {
      sql += " AND c.status_id = ?";
      params.push(status_id);
    }
    if (designation_id) {
      sql += " AND c.designation_id = ?";
      params.push(designation_id);
    }
    if (sentiment) {
      sql += " AND c.sentiment = ?";
      params.push(sentiment);
    }
    if (search) {
      sql += " AND (c.person_name LIKE ? OR c.phone_number LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    // Geographic scope from role (applies to oversight; callers already see only their own)
    if (isSupervisor(session)) {
      const scope = scopeFilterSync(session.user, "c");
      sql += " " + scope.where;
      params.push(...scope.params);
    }

    sql += " ORDER BY c.called_at DESC LIMIT 1000";

    const calls = await query(sql, params);
    return Response.json({ calls }, { status: 200 });
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
    // Admins and supervisors are oversight roles — they don't log calls themselves.
    if (isOversight(session)) {
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
      is_vip,
      contact_id,
    } = data;

    if (!person_name || !phone_number || !status_id) {
      return Response.json({ message: "Name, phone number, and status are required" }, { status: 400 });
    }

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
        session.user.id,
        duration_seconds || null,
        sentiment || null,
        is_follow_up_required ? 1 : 0,
        follow_up_date || null,
        is_vip ? 1 : 0,
        contact_id || null,
      ]
    );

    // If the call was tied to a contact: clear the lock, update completion / VIP /
    // follow-up state, and hand the contact back to the caller who scheduled the
    // follow-up so it lands in their queue on the right date.
    if (contact_id) {
      const [statusRow] = await query("SELECT name FROM call_statuses WHERE id = ?", [status_id]);
      const finalStatuses = ["Phone Picked", "Wrong Number", "Rudely Behaved"];
      const isFinal = statusRow && finalStatuses.includes(statusRow.name);
      // If a follow-up was scheduled, keep the contact open and pin it to this caller.
      const wantsFollowUp = !!is_follow_up_required;
      await query(
        `UPDATE contacts
            SET locked_by_user_id = NULL,
                locked_at = NULL,
                is_completed = CASE WHEN ? AND NOT ? THEN 1 ELSE 0 END,
                follow_up_date = CASE WHEN ? THEN ? ELSE follow_up_date END,
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
    }

    return Response.json({ message: "Call logged successfully", id: res.insertId }, { status: 201 });
  } catch (error) {
    console.error("Error logging call:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
