import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";
import { buildRuleMatch } from "@/lib/assignmentRules";

// Contacts covered by a rule: those currently assigned to the rule's caller
// (their live daily set), and those still in the pool waiting to be handed out
// on the next top-up.
export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const [rule] = await query("SELECT * FROM assignment_rules WHERE id = ?", [id]);
    if (!rule) return NextResponse.json({ message: "Rule not found" }, { status: 404 });

    const m = buildRuleMatch(rule);
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
    return NextResponse.json({ assigned, pool });
  } catch (err) {
    console.error("assignment-rules contacts error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
