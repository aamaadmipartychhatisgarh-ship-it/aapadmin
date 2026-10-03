import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isCaller, scopeFilterSync } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";

// Callers log complaints (heard live on calls); oversight roles review and
// monitor them. Both can view (callers stay geo-scoped).
const canUseComplaints = (session) => isOversight(session) || isCaller(session);

// SLA: an unresolved complaint (open / in_progress) older than this many hours is
// OVERDUE and should be escalated. One flat target keeps the rule legible; it is a
// plain integer constant, so it is safe to inline into SQL intervals below.
export const COMPLAINT_SLA_HOURS = 72;

// Optional complaints.designation_id column — the complainant's Designation, stored
// independently from their name and complaint (references the existing designations
// master). Added lazily & idempotently (feature-detected) so a deployment that
// hasn't migrated keeps working; every read/write below tolerates its absence.
let ensuredDesignation = false;
export async function ensureComplaintColumns() {
  if (ensuredDesignation) return;
  try {
    const rows = await query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'complaints' AND COLUMN_NAME = 'designation_id'`
    );
    if (Number(rows[0]?.n || 0) === 0) {
      await query("ALTER TABLE complaints ADD COLUMN designation_id INT NULL");
    }
    ensuredDesignation = true;
  } catch (e) {
    console.error("[complaints] ensureComplaintColumns:", e?.message || e);
  }
}

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "complaints", session && canUseComplaints(session)))) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensureComplaintColumns();
    const { searchParams } = new URL(req.url);
    const statusF = searchParams.get("status");
    const typeF = searchParams.get("type");
    const districtId = searchParams.get("district_id");
    const search = searchParams.get("search");
    const where = [], params = [];
    if (statusF) { where.push("c.status = ?"); params.push(statusF); }
    if (typeF) { where.push("c.type = ?"); params.push(typeF); }
    if (districtId) { where.push("c.district_id = ?"); params.push(districtId); }
    if (search) { where.push("(c.citizen_name LIKE ? OR c.citizen_phone LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
    // complaints table has district_id + assembly_id (no zone_id)
    const scope = scopeFilterSync(session.user, "c", { cols: ["district_id", "assembly_id"] });
    if (scope.where) { where.push(scope.where.replace(/^AND /, "")); params.push(...scope.params); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query(
      `SELECT c.*, ld.name AS district_name, t.name AS team_name, dg.name AS designation_name,
              TIMESTAMPDIFF(HOUR, c.created_at, NOW()) AS age_hours
         FROM complaints c
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN teams t ON t.id = c.assigned_team_id
         LEFT JOIN designations dg ON dg.id = c.designation_id
         ${whereSql}
         ORDER BY FIELD(c.status,'open','in_progress','resolved','closed'), c.created_at DESC`,
      params
    );
    // SLA timer + escalation flag, derived (no stored column): an unresolved
    // complaint past the SLA target is overdue and its hours-overdue is reported so
    // the UI can show the timer and flag it for escalation.
    const open = new Set(["open", "in_progress"]);
    const complaints = rows.map((c) => {
      const age = Number(c.age_hours) || 0;
      const unresolved = open.has(c.status);
      return {
        ...c,
        age_hours: age,
        sla_hours: COMPLAINT_SLA_HOURS,
        hours_remaining: unresolved ? COMPLAINT_SLA_HOURS - age : null,
        overdue: unresolved && age >= COMPLAINT_SLA_HOURS,
      };
    });
    const [[counts]] = await query(
      `SELECT COUNT(*) AS total,
              SUM(status='open') AS open,
              SUM(status='in_progress') AS in_progress,
              SUM(status='resolved') AS resolved,
              SUM(status IN ('open','in_progress') AND created_at < NOW() - INTERVAL ${COMPLAINT_SLA_HOURS} HOUR) AS overdue
       FROM complaints c ${scope.where ? `WHERE ${scope.where.replace(/^AND /, "")}` : ""}`,
      scope.params
    ).then((r) => [r]);
    const byType = await query(`SELECT type, COUNT(*) AS n FROM complaints GROUP BY type`);
    return NextResponse.json({ complaints, counts, byType, slaHours: COMPLAINT_SLA_HOURS });
  } catch (err) {
    console.error("complaints GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    // Logging is caller-only; admins/supervisors review complaints, they don't create them.
    if (!(await pageAllowed(session, "complaints", session && isCaller(session)))) {
      return NextResponse.json({ message: "Only callers can log complaints" }, { status: 403 });
    }
    await ensureComplaintColumns();
    const d = await req.json();
    if (!d.citizen_name) return NextResponse.json({ message: "Citizen name required" }, { status: 400 });
    const res = await query(
      `INSERT INTO complaints (citizen_name, citizen_phone, type, description, designation_id, district_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'open')`,
      [d.citizen_name, d.citizen_phone || null, d.type || "other", d.description || null, d.designation_id || null, d.district_id || null]
    );
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("complaints POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
