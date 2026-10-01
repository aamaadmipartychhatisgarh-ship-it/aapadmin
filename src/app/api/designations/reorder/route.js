import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { withConnection } from "@/lib/db";
import { isValidDesignationLevel, designationLevelLabel } from "@/lib/designationLevels";
import { ensureWingSchema } from "@/lib/wingDesignations";
import { logMasterDataChange } from "@/lib/audit";

// POST /api/designations/reorder  { level, wing, orderedIds: [id, ...] }
//
// Persist the admin's MANUAL drag-and-drop order for ONE (Level, Wing) bucket.
// This is the single source of truth for designation display order everywhere
// (worker lists, search, reports, organisation structure, dropdowns):
//  - sort_order is written as the array index (0..n) for each id, in the given order.
//  - manual_order = 1 is set so the wing auto-generator (syncWing) never overwrites
//    this hand-set order on a later wing/base edit, server restart or deployment.
//  - Each UPDATE is scoped to the (level, wing) bucket with null-safe matching, so
//    an id from a different bucket is ignored and a row can never jump buckets.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "master_data", session && isAdmin(session)))) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const level = String(body?.level || "").trim();
    if (!isValidDesignationLevel(level)) {
      return Response.json({ message: "A valid Level is required" }, { status: 400 });
    }
    // wing is optional: "" / null / undefined means the no-wing bucket.
    const wing =
      body?.wing == null || String(body.wing).trim() === "" ? null : String(body.wing).trim();
    const ids = Array.isArray(body?.orderedIds)
      ? body.orderedIds.map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    if (!ids.length) {
      return Response.json({ message: "No designations to order" }, { status: 400 });
    }

    await ensureWingSchema(); // guarantees sort_order + manual_order columns exist

    let updated = 0;
    await withConnection(async (conn) => {
      await conn.beginTransaction();
      try {
        for (let i = 0; i < ids.length; i++) {
          // eslint-disable-next-line no-await-in-loop
          const [res] = await conn.execute(
            `UPDATE designations SET sort_order = ?, manual_order = 1
               WHERE id = ? AND level <=> ? AND wing <=> ?`,
            [i, ids[i], level, wing]
          );
          updated += res.affectedRows || 0;
        }
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      }
    });

    await logMasterDataChange(session, {
      req,
      master: "designation",
      action: "Reordered",
      recordName: `${designationLevelLabel(level) || level}${wing ? " / " + wing : ""}`,
      after: { level, wing, count: updated },
    });
    return Response.json({ ok: true, updated });
  } catch (error) {
    console.error("designation reorder error:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
