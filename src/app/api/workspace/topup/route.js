import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { buildRuleMatch, zoneMatch } from "@/lib/assignmentRules";

// On-demand daily top-up for the signed-in caller. For each active rule, fill
// the caller's queue up to the daily quota: first from the unassigned pool,
// then — if still short — by taking matching contacts away from other callers
// (locks cleared, even mid-call). Bounded to the caller's home zone.
//
// Runs when the caller opens their workspace — no scheduler needed.
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      const [rules] = await conn.execute(
        `SELECT * FROM assignment_rules WHERE caller_user_id = ? AND is_active = 1`,
        [userId]
      );
      if (rules.length === 0) {
        conn.release();
        return NextResponse.json({ assigned: 0, taken_from_others: 0, rules: 0 });
      }

      // The caller's home zone bounds every rule — daily assignment always pulls
      // from that zone (the rule's own geo/designation narrows further).
      const [[me]] = await conn.execute(`SELECT scope_zone_id FROM users WHERE id = ?`, [userId]);
      const zone = zoneMatch(me?.scope_zone_id);

      let assignedTotal = 0;
      let takenTotal = 0;

      for (const rule of rules) {
        const rm = buildRuleMatch(rule);
        // Rule filter AND the caller's zone.
        const m = { where: rm.where + zone.where, params: [...rm.params, ...zone.params] };

        await conn.beginTransaction();
        try {
          // How many due, pending, matching contacts this caller already holds.
          const [[held]] = await conn.execute(
            `SELECT COUNT(*) AS n FROM contacts c
              WHERE c.assigned_to_user_id = ? AND c.is_completed = 0
                AND (c.follow_up_date IS NULL OR c.follow_up_date <= CURDATE())
                ${m.where}`,
            [userId, ...m.params]
          );
          let need = Math.max(0, (Number(rule.daily_quota) || 0) - Number(held.n || 0));

          // (1) Fill from the unassigned pool first (locked rows skipped).
          if (need > 0) {
            const [poolRows] = await conn.execute(
              `SELECT c.id FROM contacts c
                WHERE c.is_completed = 0
                  AND c.assigned_to_user_id IS NULL
                  AND (c.follow_up_date IS NULL OR c.follow_up_date <= CURDATE())
                  AND (c.locked_by_user_id IS NULL OR c.locked_at < NOW() - INTERVAL 10 MINUTE)
                  ${m.where}
                ORDER BY c.is_vip DESC, c.id ASC
                LIMIT ${need} FOR UPDATE`,
              m.params
            );
            if (poolRows.length) {
              const ids = poolRows.map((r) => r.id);
              const ph = ids.map(() => "?").join(",");
              await conn.execute(
                `UPDATE contacts SET assigned_to_user_id = ?, assigned_at = NOW() WHERE id IN (${ph})`,
                [userId, ...ids]
              );
              assignedTotal += ids.length;
              need -= ids.length;
            }
          }

          // (2) Still short of quota? Take matching, due contacts from OTHER
          // callers — oldest-held first — and move them here (locks cleared),
          // even if they're mid-call.
          if (need > 0) {
            const [otherRows] = await conn.execute(
              `SELECT c.id FROM contacts c
                WHERE c.is_completed = 0
                  AND c.assigned_to_user_id IS NOT NULL
                  AND c.assigned_to_user_id <> ?
                  AND (c.follow_up_date IS NULL OR c.follow_up_date <= CURDATE())
                  ${m.where}
                ORDER BY c.assigned_at ASC, c.id ASC
                LIMIT ${need} FOR UPDATE`,
              [userId, ...m.params]
            );
            if (otherRows.length) {
              const ids = otherRows.map((r) => r.id);
              const ph = ids.map(() => "?").join(",");
              await conn.execute(
                `UPDATE contacts SET assigned_to_user_id = ?, assigned_at = NOW(),
                        locked_by_user_id = NULL, locked_at = NULL WHERE id IN (${ph})`,
                [userId, ...ids]
              );
              takenTotal += ids.length;
            }
          }

          await conn.commit();
        } catch (e) {
          await conn.rollback();
          throw e;
        }
      }

      conn.release();
      return NextResponse.json({ assigned: assignedTotal, taken_from_others: takenTotal, rules: rules.length });
    } catch (e) {
      conn.release();
      throw e;
    }
  } catch (err) {
    // If the assignment-rules migration hasn't run on this deployment yet, the
    // table/column is missing — degrade to a no-op instead of breaking the
    // caller's workspace.
    if (err.code === "ER_NO_SUCH_TABLE" || err.code === "ER_BAD_FIELD_ERROR") {
      return NextResponse.json({ assigned: 0, taken_from_others: 0, rules: 0, needs_migration: true });
    }
    console.error("workspace topup error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
