import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { buildRuleMatch } from "@/lib/assignmentRules";

// On-demand daily top-up for the signed-in caller. For each of their active
// assignment rules: (1) reclaim matching contacts that another caller was
// assigned but left untouched past the stale window (back to the pool), then
// (2) fill this caller's queue from the pool up to the rule's daily quota.
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
        return NextResponse.json({ assigned: 0, reclaimed: 0, rules: 0 });
      }

      let assignedTotal = 0;
      let reclaimedTotal = 0;

      for (const rule of rules) {
        const m = buildRuleMatch(rule);

        await conn.beginTransaction();
        try {
          // (1) Reclaim: matching contacts held by ANOTHER caller, not completed,
          // not freshly assigned, never called since they were assigned, and not
          // actively locked — hand them back to the pool.
          const [rec] = await conn.execute(
            `UPDATE contacts c
                SET c.assigned_to_user_id = NULL, c.assigned_at = NULL,
                    c.locked_by_user_id = NULL, c.locked_at = NULL
              WHERE c.is_completed = 0
                AND c.assigned_to_user_id IS NOT NULL
                AND c.assigned_to_user_id <> ?
                AND (c.locked_by_user_id IS NULL OR c.locked_at < NOW() - INTERVAL 10 MINUTE)
                AND c.assigned_at IS NOT NULL
                AND c.assigned_at < NOW() - INTERVAL ${Number(rule.stale_days) || 3} DAY
                AND NOT EXISTS (SELECT 1 FROM calls cx WHERE cx.contact_id = c.id AND cx.called_at >= c.assigned_at)
                ${m.where}`,
            [userId, ...m.params]
          );
          reclaimedTotal += rec.affectedRows || 0;

          // (2) How many due, pending, matching contacts this caller already holds.
          const [[held]] = await conn.execute(
            `SELECT COUNT(*) AS n FROM contacts c
              WHERE c.assigned_to_user_id = ? AND c.is_completed = 0
                AND (c.follow_up_date IS NULL OR c.follow_up_date <= CURDATE())
                ${m.where}`,
            [userId, ...m.params]
          );
          const need = Math.max(0, (Number(rule.daily_quota) || 0) - Number(held.n || 0));

          if (need > 0) {
            // Pull from the unassigned pool (locked rows skipped) up to `need`.
            const [poolRows] = await conn.execute(
              `SELECT c.id FROM contacts c
                WHERE c.is_completed = 0
                  AND c.assigned_to_user_id IS NULL
                  AND (c.follow_up_date IS NULL OR c.follow_up_date <= CURDATE())
                  AND (c.locked_by_user_id IS NULL OR c.locked_at < NOW() - INTERVAL 10 MINUTE)
                  ${m.where}
                ORDER BY c.is_vip DESC, c.id ASC
                LIMIT ${need}
                FOR UPDATE`,
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
            }
          }

          await conn.commit();
        } catch (e) {
          await conn.rollback();
          throw e;
        }
      }

      conn.release();
      return NextResponse.json({ assigned: assignedTotal, reclaimed: reclaimedTotal, rules: rules.length });
    } catch (e) {
      conn.release();
      throw e;
    }
  } catch (err) {
    // If the assignment-rules migration hasn't run on this deployment yet, the
    // table/column is missing — degrade to a no-op instead of breaking the
    // caller's workspace.
    if (err.code === "ER_NO_SUCH_TABLE" || err.code === "ER_BAD_FIELD_ERROR") {
      return NextResponse.json({ assigned: 0, reclaimed: 0, rules: 0, needs_migration: true });
    }
    console.error("workspace topup error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
