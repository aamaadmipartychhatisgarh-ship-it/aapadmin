import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { contactsByAssembly } from "@/lib/workerCounts";
import { ensureInfluencerSchema } from "@/lib/influencerSchema";

// GET /api/dashboard/assembly-breakdown
// Assembly-wise counts for the Dashboard's bottom section:
//   • workers     — the SAME live, person-aware Contacts-based worker count per
//     assembly the Analytics tab used (contactsByAssembly), keyed by assembly_id.
//   • influencers — the live Influencer count per assembly (influencers.assembly_id).
// BOTH iterate EVERY master assembly (locations type='assembly'), so assemblies
// with zero workers or zero influencers are returned as 0, never omitted, and both
// use the same Assembly master so the geography is consistent across the system.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "analytics", session && isOversight(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }

    // Every assembly from the master (single source of truth), zero rows included.
    const asmRows = await query(
      `SELECT id, name FROM locations WHERE type = 'assembly' ORDER BY name ASC`
    );

    // Workers by Assembly — identical calculation to the Analytics tab.
    let workers = [];
    try {
      const counts = await contactsByAssembly();
      workers = asmRows
        .map((a) => ({ id: a.id, assembly: a.name, workers: Number(counts.get(a.id) || 0) }))
        .sort((x, y) => y.workers - x.workers || String(x.assembly).localeCompare(String(y.assembly)));
    } catch (e) {
      console.error("[assembly-breakdown] workers failed:", e?.code || e?.message || e);
      workers = asmRows.map((a) => ({ id: a.id, assembly: a.name, workers: 0 }));
    }

    // Influencers by Assembly — live count from the influencers table, every
    // assembly included (0 where none). Recomputed each call, so add/edit/remove is
    // reflected automatically.
    let influencers = [];
    try {
      await ensureInfluencerSchema();
      const rows = await query(
        `SELECT a.id, a.name AS assembly, COUNT(i.id) AS influencers
           FROM locations a
           LEFT JOIN influencers i ON i.assembly_id = a.id
          WHERE a.type = 'assembly'
          GROUP BY a.id, a.name`
      );
      influencers = rows
        .map((r) => ({ id: r.id, assembly: r.assembly, influencers: Number(r.influencers) || 0 }))
        .sort((x, y) => y.influencers - x.influencers || String(x.assembly).localeCompare(String(y.assembly)));
    } catch (e) {
      console.error("[assembly-breakdown] influencers failed:", e?.code || e?.message || e);
      influencers = asmRows.map((a) => ({ id: a.id, assembly: a.name, influencers: 0 }));
    }

    return NextResponse.json({ workers, influencers }, { headers: NO_STORE });
  } catch (err) {
    console.error("[assembly-breakdown] GET error:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
