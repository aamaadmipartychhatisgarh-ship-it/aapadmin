import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { contactsByAssembly, workerAssemblyReconciliation } from "@/lib/workerCounts";
import { influencerAssemblyCounts } from "@/lib/influencerCounts";

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

    // Influencers by Assembly + the overall total, from ONE shared dataset (lib/influencerCounts): every influencer record once, under its
    // own valid assembly_id; records with no / an invalid assembly are reported separately (influencers_overall), never under an assembly.
    let influencers = [], influencers_overall = null;
    try {
      const ic = await influencerAssemblyCounts();
      influencers = asmRows
        .map((a) => ({ id: a.id, assembly: a.name, influencers: ic.byAssembly.get(a.id) || 0 }))
        .sort((x, y) => y.influencers - x.influencers || String(x.assembly).localeCompare(String(y.assembly)));
      influencers_overall = { total: ic.total, mapped: ic.mapped, unmapped: ic.unmapped, no_assembly: ic.no_assembly, invalid_assembly: ic.invalid_assembly,
        sum_of_assemblies: influencers.reduce((acc, r) => acc + r.influencers, 0) };
    } catch (e) {
      console.error("[assembly-breakdown] influencers failed:", e?.code || e?.message || e);
      influencers = asmRows.map((a) => ({ id: a.id, assembly: a.name, influencers: 0 }));
    }

    // Overall unique workers vs the assembly figures: total = in an assembly + not mapped (no / invalid assembly) - nothing is forced.
    let workers_overall = null;
    try {
      const rec = await workerAssemblyReconciliation();
      workers_overall = { ...rec, sum_of_assemblies: workers.reduce((a, w) => a + w.workers, 0) };
    } catch (e) { console.error("[assembly-breakdown] reconciliation failed:", e?.code || e?.message || e); }

    return NextResponse.json({ workers, influencers, workers_overall, influencers_overall }, { headers: NO_STORE });
  } catch (err) {
    console.error("[assembly-breakdown] GET error:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
