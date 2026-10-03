import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query, withConnection } from "@/lib/db";
import { ensureWingSchema } from "@/lib/wingDesignations";
import { logMasterDataChange } from "@/lib/audit";

// POST /api/designations/rank
//   { id, rank }        → set ONE designation's GLOBAL rank (1-based), re-sequencing
//                          every designation so the order stays 1..N with no gaps or
//                          duplicates (§11 deterministic conflict handling).
//   { orderedIds: [...] } → bulk: set the global rank to the given order (the drag
//                          editor). Any designation not listed keeps its relative
//                          position after the listed ones.
//
// Rank is the SINGLE SOURCE OF TRUTH for designation order across the whole app. It
// is written to designations.`rank`, and MIRRORED into sort_order (+ manual_order=1)
// so every existing consumer that already orders by sort_order reflects the global
// rank WITHOUT referencing the `rank` column in its own SQL, and the wing
// auto-generator never overwrites it. Order-only: ids, names, levels, wings and all
// assignments are untouched.
const ORDER_SQL = "ORDER BY (`rank` IS NULL), `rank`, (sort_order IS NULL), sort_order, name, id";

async function resequence(ids) {
  await withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      for (let i = 0; i < ids.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        await conn.execute("UPDATE designations SET `rank` = ?, sort_order = ?, manual_order = 1 WHERE id = ?", [i + 1, i + 1, ids[i]]);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    }
  });
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "master_data", session && isAdmin(session)))) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    await ensureWingSchema(); // guarantees `rank` + sort_order + manual_order columns

    const body = await req.json().catch(() => ({}));

    // All designations in their current global order.
    const all = (await query(`SELECT id FROM designations ${ORDER_SQL}`)).map((r) => r.id);

    // --- Bulk mode: an explicit full/partial order from the drag editor ----------
    if (Array.isArray(body?.orderedIds)) {
      // De-duplicate so a repeated id can't be assigned two different ranks (which
      // would push a legitimate designation off the tail / skip a rank number) — L1.
      const wanted = [...new Set(body.orderedIds.map((x) => parseInt(x, 10)).filter((x) => Number.isInteger(x) && x > 0))];
      const seen = new Set(wanted);
      const ids = [...wanted, ...all.filter((x) => !seen.has(x))]; // listed first, rest keep order
      if (!ids.length) return Response.json({ message: "Nothing to rank" }, { status: 400 });
      await resequence(ids);
      await logMasterDataChange(session, { req, master: "designation", action: "Reranked", after: { count: wanted.length } });
      return Response.json({ ok: true, count: ids.length });
    }

    // --- Batch-place mode: drop a SET of ids consecutively at a target rank in ONE
    //     re-sequence. The Add form creates several rows at once (multiple Levels ×
    //     Wings); calling single mode per row did a full-table re-sequence N times
    //     (N+1 round-trips, tens of thousands of row UPDATEs). This does it once (M3).
    if (Array.isArray(body?.placeIds)) {
      const place = [...new Set(body.placeIds.map((x) => parseInt(x, 10)).filter((x) => Number.isInteger(x) && x > 0))];
      if (!place.length) return Response.json({ message: "Nothing to rank" }, { status: 400 });
      const placeSet = new Set(place);
      const rest = all.filter((x) => !placeSet.has(x));
      const atRank = parseInt(body?.atRank, 10);
      const target = Number.isInteger(atRank) && atRank >= 1 ? Math.min(atRank - 1, rest.length) : rest.length;
      const ids = [...rest.slice(0, target), ...place, ...rest.slice(target)];
      await resequence(ids);
      await logMasterDataChange(session, { req, master: "designation", action: "Reranked", after: { count: place.length } });
      return Response.json({ ok: true, count: ids.length, placed: place.length, atRank: target + 1 });
    }

    // --- Single mode: move one designation to a target global rank --------------
    const id = parseInt(body?.id, 10);
    const rank = parseInt(body?.rank, 10);
    if (!Number.isInteger(id) || id <= 0) return Response.json({ message: "A valid designation is required" }, { status: 400 });
    if (!Number.isInteger(rank) || rank < 1) return Response.json({ message: "Rank must be a whole number ≥ 1" }, { status: 400 });

    const [row] = await query("SELECT id, name FROM designations WHERE id = ?", [id]);
    if (!row) return Response.json({ message: "Designation not found" }, { status: 404 });

    const ids = all.filter((x) => x !== id);
    const target = Math.min(Math.max(rank - 1, 0), ids.length); // clamp into range
    ids.splice(target, 0, id);
    await resequence(ids);

    await logMasterDataChange(session, {
      req, master: "designation", action: "Ranked", recordId: id, recordName: row.name,
      after: { rank: target + 1 },
    });
    return Response.json({ ok: true, id, rank: target + 1 });
  } catch (error) {
    console.error("designation rank error:", error);
    return Response.json({ message: "Internal server error", detail: error?.sqlMessage || error?.message || null }, { status: 500 });
  }
}
