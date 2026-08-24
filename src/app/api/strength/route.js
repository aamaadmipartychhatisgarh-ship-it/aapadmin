import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { districtWorkerStats } from "@/lib/districtStats";

// District Strength Ranking. Every worker/percentage figure comes from the ONE
// shared district-stats service (districtWorkerStats) that Area Ranking, the
// Workers-by-District tree map and the Organization Map also use — so the same
// district always shows the same numbers everywhere. Nothing is hardcoded:
// Workers = live Contacts count per district, Strength % = actual/required×100.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "strength", session && isOversight(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const stats = await districtWorkerStats(session);
    const scored = stats
      .map((d) => {
        const score = d.strengthPercentage; // = clamp(actual/required×100)
        const band = score >= 60 ? "strong" : score >= 35 ? "medium" : "weak";
        return {
          id: d.id,
          name: d.district,
          district: d.district,
          zone: d.zone,
          requiredWorkers: d.requiredWorkers,
          workers: d.actualWorkers,
          attemptCalls: d.attemptCalls,
          strength: score,
          score,
          band,
          // Back-compat aliases still read by any older UI build.
          worker_count: d.actualWorkers,
          call_count: d.attemptCalls,
        };
      })
      // Rank by strength % desc, then actual worker count, then name (stable).
      .sort((a, b) => b.score - a.score || b.workers - a.workers || a.name.localeCompare(b.name));

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
