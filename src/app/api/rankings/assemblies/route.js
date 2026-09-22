import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { contactsByAssembly } from "@/lib/workerCounts";

// Assembly-wise "Area Ranking" for Strength & Ranking. Every assembly (from the
// locations master) is ranked by its ACTUAL worker/contact count — the same
// person-aware, active-record count the rest of Strength uses (contactsByAssembly),
// so the numbers reconcile and nothing is hardcoded. An assembly with zero workers
// still appears (count 0). Each assembly also carries its CURRENT MEMBER (MLA), read
// from the existing Leader Assessment relationship by id — never by name — so every
// assembly shows its own current member (or "Not Assigned"). Gated by the same
// "rankings" access as the Rankings page.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "rankings", session && isOversight(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const [byAssembly, rows] = await Promise.all([
      contactsByAssembly(), // Map<assembly_id, worker count>
      query(
        `SELECT a.id AS id, a.name AS assembly_name, d.name AS district_name
           FROM locations a
           LEFT JOIN locations d ON d.id = a.parent_id AND d.type = 'district'
          WHERE a.type = 'assembly'
          ORDER BY a.name ASC`
      ),
    ]);

    // Current Member per master assembly, via the AUTHORITATIVE id chain:
    //   locations.id (master assembly) ← la_assemblies.location_id
    //   la_assemblies.id              ← la_mla_profiles.assembly_id
    // Keyed by the master assembly id (never matched by name), so each assembly
    // shows its OWN current member. Defensive: on a deployment without the Leader
    // Assessment tables the members stay unmapped and every assembly renders as
    // "Not Assigned" rather than failing the ranking.
    let memberByLoc = new Map();
    try {
      const mrows = await query(
        `SELECT la.location_id AS location_id, mp.name AS name, mp.photo_url AS photo_url
           FROM la_assemblies la
           JOIN la_mla_profiles mp ON mp.assembly_id = la.id
          WHERE la.location_id IS NOT NULL
            AND NULLIF(TRIM(mp.name), '') IS NOT NULL`
      );
      memberByLoc = new Map(mrows.map((r) => [Number(r.location_id), { name: r.name, photo_url: r.photo_url || null }]));
    } catch (e) {
      console.error("[assembly rankings] current member lookup:", e?.message || e);
    }

    const ranked = rows
      .map((r) => {
        const m = memberByLoc.get(Number(r.id)) || null;
        return {
          id: r.id,
          assembly_name: r.assembly_name || null,
          district_name: r.district_name || null,
          workers: Number(byAssembly.get(r.id) || 0),
          current_member_name: m?.name || null,
          current_member_photo: m?.photo_url || null,
        };
      })
      // Highest worker count first; ties broken by name for a stable order.
      .sort((a, b) => b.workers - a.workers || String(a.assembly_name || "").localeCompare(String(b.assembly_name || "")))
      .map((a, i) => ({ ...a, rank: i + 1 }));

    const totalWorkers = ranked.reduce((s, a) => s + a.workers, 0);
    return NextResponse.json(
      {
        assemblies: ranked,
        totals: {
          assemblies: ranked.length,
          workers: totalWorkers,
          top: ranked[0] && ranked[0].workers > 0 ? ranked[0] : null,
        },
      },
      { status: 200 }
    );
  } catch (e) {
    console.error("assembly rankings GET error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
