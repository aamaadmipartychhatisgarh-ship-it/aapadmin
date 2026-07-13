import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";
import { buildRuleMatch, parseIds } from "@/lib/assignmentRules";

// GET: list all rules with caller name + a live "matching pending pool" count.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const rules = await query(
      `SELECT r.*, u.username AS caller_name
         FROM assignment_rules r
         JOIN users u ON u.id = r.caller_user_id
        ORDER BY u.username ASC, r.id ASC`
    );
    // Annotate each with how many unassigned, pending contacts currently match.
    for (const r of rules) {
      const m = buildRuleMatch(r);
      const rows = await query(
        `SELECT COUNT(*) AS n FROM contacts c
          WHERE c.is_completed = 0 AND c.assigned_to_user_id IS NULL ${m.where}`,
        m.params
      );
      r.pool_matches = Number(rows[0]?.n || 0);
      r.designation_ids = parseIds(r.designation_ids); // hand back as an array
    }
    return NextResponse.json({ rules });
  } catch (err) {
    if (err.code === "ER_NO_SUCH_TABLE") {
      // Migration not run yet on this deployment.
      return NextResponse.json({ rules: [], needs_migration: true });
    }
    console.error("assignment-rules GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// POST: create a rule. Body: { caller_user_id, designation_ids[], zone_id,
// lok_sabha_id, district_id, assembly_id, daily_quota, stale_days }
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const b = await req.json();
    if (!b.caller_user_id) {
      return NextResponse.json({ message: "Pick a caller." }, { status: 400 });
    }
    const designationCsv = parseIds(Array.isArray(b.designation_ids) ? b.designation_ids.join(",") : b.designation_ids).join(",");
    const res = await query(
      `INSERT INTO assignment_rules
         (caller_user_id, designation_ids, zone_id, lok_sabha_id, district_id, assembly_id, daily_quota, stale_days, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        b.caller_user_id,
        designationCsv || null,
        b.zone_id || null,
        b.lok_sabha_id || null,
        b.district_id || null,
        b.assembly_id || null,
        Math.max(1, parseInt(b.daily_quota, 10) || 100),
        Math.max(1, parseInt(b.stale_days, 10) || 3),
      ]
    );
    return NextResponse.json({ id: res.insertId }, { status: 201 });
  } catch (err) {
    console.error("assignment-rules POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
