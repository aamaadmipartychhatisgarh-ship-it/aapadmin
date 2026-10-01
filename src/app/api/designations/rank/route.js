import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query, withConnection } from "@/lib/db";
import { ensureWingSchema } from "@/lib/wingDesignations";
import { logMasterDataChange } from "@/lib/audit";

// POST /api/designations/rank  { id, rank }
//
// Set a designation's RANK — its 1-based position within its own (Level, Wing)
// group. Rank is the single source of truth for designation display order across
// the app; it is stored in designations.sort_order (0-based), so this moves the
// row to position rank-1 inside its group and rewrites the whole group's
// sort_order to a clean contiguous 0..n sequence. manual_order=1 is set so the
// wing auto-generator never overwrites the hand-set order. Scoped to the one
// group (null-safe level/wing match), transactional, assignment-safe (only the
// order column changes — ids, names, levels, wings and assignments are untouched).
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "master_data", session && isAdmin(session)))) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const id = parseInt(body?.id, 10);
    const rank = parseInt(body?.rank, 10);
    if (!Number.isInteger(id) || id <= 0) return Response.json({ message: "A valid designation is required" }, { status: 400 });
    if (!Number.isInteger(rank) || rank < 1) return Response.json({ message: "Rank must be a whole number ≥ 1" }, { status: 400 });

    await ensureWingSchema(); // sort_order + manual_order columns

    const [row] = await query("SELECT id, name, level, wing FROM designations WHERE id = ?", [id]);
    if (!row) return Response.json({ message: "Designation not found" }, { status: 404 });

    // The group's current order (same deterministic order used everywhere).
    const groupRows = await query(
      `SELECT id FROM designations WHERE level <=> ? AND wing <=> ?
        ORDER BY (sort_order IS NULL), sort_order, name`,
      [row.level ?? null, row.wing ?? null]
    );
    const ids = groupRows.map((r) => r.id).filter((x) => x !== id);
    const target = Math.min(Math.max(rank - 1, 0), ids.length); // clamp into range
    ids.splice(target, 0, id);

    await withConnection(async (conn) => {
      await conn.beginTransaction();
      try {
        for (let i = 0; i < ids.length; i++) {
          // eslint-disable-next-line no-await-in-loop
          await conn.execute("UPDATE designations SET sort_order = ?, manual_order = 1 WHERE id = ?", [i, ids[i]]);
        }
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      }
    });

    await logMasterDataChange(session, {
      req, master: "designation", action: "Ranked", recordId: id, recordName: row.name,
      after: { rank: target + 1, level: row.level ?? null, wing: row.wing ?? null },
    });
    return Response.json({ ok: true, id, rank: target + 1 });
  } catch (error) {
    console.error("designation rank error:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
