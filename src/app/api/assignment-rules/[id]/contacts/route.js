import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";
import { buildRuleMatch, zoneMatch } from "@/lib/assignmentRules";

// Contacts covered by a rule, exactly as the top-up sees them (rule filter AND
// the caller's home zone): those assigned to the caller now, those waiting in
// the pool, and those held by OTHER callers that the rule will pull in.
export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const [rule] = await query("SELECT * FROM assignment_rules WHERE id = ?", [id]);
    if (!rule) return NextResponse.json({ message: "Rule not found" }, { status: 404 });

    // Match = rule's own filters AND the caller's home zone (as the top-up runs).
    const [caller] = await query("SELECT scope_zone_id FROM users WHERE id = ?", [rule.caller_user_id]);
    const rm = buildRuleMatch(rule);
    const z = zoneMatch(caller?.scope_zone_id);
    const m = { where: rm.where + z.where, params: [...rm.params, ...z.params] };

    const cols = `c.id, c.person_name, c.phone_number, c.is_completed,
                  ld.name AS district_name, dsg.name AS designation_name`;
    const joins = `LEFT JOIN locations ld ON ld.id = c.district_id
                   LEFT JOIN designations dsg ON dsg.id = c.designation_id`;

    const assigned = await query(
      `SELECT ${cols} FROM contacts c ${joins}
        WHERE c.assigned_to_user_id = ? AND c.is_completed = 0 ${m.where}
        ORDER BY c.id ASC LIMIT 300`,
      [rule.caller_user_id, ...m.params]
    );
    const pool = await query(
      `SELECT ${cols} FROM contacts c ${joins}
        WHERE c.assigned_to_user_id IS NULL AND c.is_completed = 0 ${m.where}
        ORDER BY c.id ASC LIMIT 300`,
      m.params
    );
    const others = await query(
      `SELECT ${cols}, ou.username AS owner_name FROM contacts c ${joins}
         LEFT JOIN users ou ON ou.id = c.assigned_to_user_id
        WHERE c.assigned_to_user_id IS NOT NULL AND c.assigned_to_user_id <> ?
          AND c.is_completed = 0 ${m.where}
        ORDER BY c.id ASC LIMIT 300`,
      [rule.caller_user_id, ...m.params]
    );
    return NextResponse.json({ assigned, pool, others });
  } catch (err) {
    console.error("assignment-rules contacts error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
