import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isCaller, scopeFilterSync } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query, getPool } from "@/lib/db";
import { createHash } from "crypto";
import { phoneKey, last10Sql } from "@/lib/phone";
import { resolveComplaintLocation, contactDesignationId } from "@/lib/complaintWorker";
import { loadComplaintRows } from "@/lib/complaintsList";

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
    // assembly_id is part of the original schema; add it only if a deployment lacks it.
    const asm = await query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'complaints' AND COLUMN_NAME = 'assembly_id'`
    );
    if (Number(asm[0]?.n || 0) === 0) await query("ALTER TABLE complaints ADD COLUMN assembly_id INT NULL");
    // Free-text address of the complainant, searchable from the Complaint List.
    const addr = await query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'complaints' AND COLUMN_NAME = 'citizen_address'`
    );
    if (Number(addr[0]?.n || 0) === 0) await query("ALTER TABLE complaints ADD COLUMN citizen_address TEXT NULL");
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
    const { rows, scope } = await loadComplaintRows(session, searchParams);
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

// DUPLICATE RULE: a complaint is refused only when Phone number (last 10 digits, so +91 / 0 / spaces / dashes do not
// matter) + Department + Subject ALL match a complaint registered within the previous 7 days. In this data model the
// Department is the complaint's Type and the Subject is its Description (trimmed, spaces collapsed, case-insensitive).
// Nothing else blocks a registration; with no phone number or no description there is nothing to compare, so it is allowed.
const DUPLICATE_COMPLAINT_MESSAGE = "Complaint already registered within the last 1 week.";
const DUPLICATE_WINDOW_DAYS = 7;
const normSubject = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const SUBJECT_SQL = "TRIM(REGEXP_REPLACE(IFNULL(description,''), '[[:space:]]+', ' '))";

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
    // The Assembly is taken from the real Worker (contact) record for this mobile
    // number — never from the client. If the form chose one of several matching
    // workers it sends contact_id (verified to own the number); otherwise a single
    // unambiguous match is used; no match / ambiguous → NULL, never a guess. The
    // district is only filled from the worker when the form left it blank.
    const loc = await resolveComplaintLocation({ phone: d.citizen_phone, contactId: d.contact_id });
    // Workspace complaints show the contact's designation read-only, so it is
    // taken from the verified contact record here — any client designation_id is
    // ignored (no contact / number not owned by it → no designation).
    let designationId = d.designation_id || null;
    if (d.designation_from_contact) designationId = d.contact_id ? await contactDesignationId(loc.contact_id) : null;
    const type = d.type || "other";
    const pKey = phoneKey(d.citizen_phone);
    const subject = normSubject(d.description);
    const params = [d.citizen_name, d.citizen_phone || null, String(d.citizen_address || "").trim().slice(0, 1000) || null, type, d.description || null, designationId, d.district_id || loc.district_id || null, loc.assembly_id];
    const insertSql = `INSERT INTO complaints (citizen_name, citizen_phone, citizen_address, type, description, designation_id, district_id, assembly_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`;

    // Check + insert happen under a per-combination database lock, so two simultaneous submissions of the same
    // combination are serialised: the second one sees the first and is refused. Other combinations never wait.
    let res;
    if (pKey && subject) {
      const lockName = "cmpl:" + createHash("md5").update(`${pKey}|${type}|${subject.toLowerCase()}`).digest("hex");
      const conn = await getPool().getConnection();
      let locked = false;
      try {
        const [[lk]] = await conn.query("SELECT GET_LOCK(?, 10) AS ok", [lockName]);
        locked = Number(lk.ok) === 1;
        if (!locked) return NextResponse.json({ message: "Please try again in a moment." }, { status: 503 });
        // created_at and NOW() are both the database's own clock/time zone, so the 7-day window is consistent.
        const [dup] = await conn.query(
          `SELECT id FROM complaints
            WHERE ${last10Sql("citizen_phone")} = ? AND type = ? AND ${SUBJECT_SQL} = ?
              AND created_at >= NOW() - INTERVAL ${DUPLICATE_WINDOW_DAYS} DAY
            LIMIT 1`,
          [pKey, type, subject]
        );
        if (dup.length) return NextResponse.json({ message: DUPLICATE_COMPLAINT_MESSAGE }, { status: 409 });
        [res] = await conn.query(insertSql, params);
      } finally {
        if (locked) await conn.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => {});
        conn.release();
      }
    } else {
      res = await query(insertSql, params);
    }
    return NextResponse.json({ id: res.insertId, assembly_id: loc.assembly_id }, { status: 201 });
  } catch (err) {
    console.error("complaints POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
