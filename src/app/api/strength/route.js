import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, normalizeRole, ROLES } from "@/lib/permissions";
import { query } from "@/lib/db";
import { contactsByDistrict } from "@/lib/workerCounts";
import { requiredWorkersFor } from "@/lib/chhattisgarhAssemblies";

// Required-Workers targets (fixed per-district planning values) and the
// name-normalizing lookup now live in @/lib/chhattisgarhAssemblies so the
// Strength page and Area Ranking compute the SAME percentage from one source.

// The Workers column now reflects the actual people data in Contacts: for each
// district it is the live count of contacts keyed by that district_id, using
// the SAME definition the District Map uses (wrong-number-flagged contacts
// excluded). Because it is a live COUNT it automatically tracks contacts being
// added, removed or reassigned, each contact is counted once (no duplicates),
// and no district total is ever hardcoded.

// Organization strength score per district, combining the actual workforce
// (contacts assigned to the district) and calling performance (attempt volume +
// connect rate). Teams and per-worker "activity score" are not part of this view.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    // Scope which districts the user sees: zone-admin → districts in that zone,
    // district-admin → only their district, assembly-admin → district of their assembly.
    const role = normalizeRole(session.user.role);
    const u = session.user;
    let districtFilter = "";
    const dParams = [];
    if (role === ROLES.ZONE_ADMIN && u.scope_zone_id) {
      // districts whose parent (lok_sabha) parent is the zone
      districtFilter = `AND ld.parent_id IN (SELECT id FROM locations WHERE type='lok_sabha' AND parent_id = ?)`;
      dParams.push(u.scope_zone_id);
    } else if (role === ROLES.DISTRICT_ADMIN && u.home_district_id) {
      districtFilter = `AND ld.id = ?`;
      dParams.push(u.home_district_id);
    } else if (role === ROLES.ASSEMBLY_ADMIN && u.scope_assembly_id) {
      // district that owns this assembly
      districtFilter = `AND ld.id = (SELECT parent_id FROM locations WHERE id = ?)`;
      dParams.push(u.scope_assembly_id);
    }

    // Worker count = live contacts-per-district COUNT via the shared helper, so
    // this page and Area Ranking always agree for a given district.
    const [rows, contactCounts] = await Promise.all([
      query(
        `SELECT ld.id, ld.name,
                (SELECT COUNT(*) FROM calls c WHERE c.district_id = ld.id) AS call_count,
                (SELECT COUNT(*) FROM calls c JOIN call_statuses cs ON cs.id=c.status_id
                   WHERE c.district_id = ld.id AND cs.name='Phone Picked') AS connected_count
           FROM locations ld
          WHERE ld.type = 'district' ${districtFilter}
          ORDER BY ld.name`,
        dParams
      ),
      contactsByDistrict(),
    ]);

    // Strength % = (actual workers / required workers) x 100, as a whole number.
    // Actual workers come from Contacts (contactCounts); required workers are the
    // fixed district targets. Guards: required=0 -> 0% (never NaN/Infinity), and
    // the value is clamped to 0..100 so a district that meets or exceeds its
    // target reads 100% and fills the bar without overflowing the UI. Because
    // the worker count is live, the percentage updates as Contacts change.
    const withWorkers = rows.map((r) => ({ ...r, worker_count: contactCounts.get(r.id) || 0 }));
    const scored = withWorkers.map((r) => {
      const requiredWorkers = requiredWorkersFor(r.name);
      const workers = r.worker_count;
      const rawPct = requiredWorkers > 0 ? Math.round((workers / requiredWorkers) * 100) : 0;
      const score = Math.min(100, Math.max(0, rawPct));
      const band = score >= 60 ? "strong" : score >= 35 ? "medium" : "weak";
      return {
        id: r.id,
        name: r.name,
        score,
        band,
        district: r.name,
        requiredWorkers,
        workers,
        attemptCalls: r.call_count,
        strength: score,
        // Back-compat aliases still read by any older UI build.
        worker_count: r.worker_count,
        call_count: r.call_count,
      };
      // Rank by strength % desc, then by actual worker count, then name (stable).
    }).sort((a, b) => b.score - a.score || b.workers - a.workers || a.name.localeCompare(b.name));

    const summary = {
      strong: scored.filter((s) => s.band === "strong").length,
      medium: scored.filter((s) => s.band === "medium").length,
      weak: scored.filter((s) => s.band === "weak").length,
    };

    return NextResponse.json({ areas: scored, summary });
  } catch (err) {
    console.error("strength error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
