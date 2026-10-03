import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { PLUGIN_CATALOG, COMPARE_DIMS, catalogStats, catalogReport } from "@/lib/pluginCatalog";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// GET /api/plugins
//   default   → the full catalog (plugins + comparison dimensions + roll-up
//               stats) for the About & Features page.
//   ?report=1 → just the per-plugin certification report (feature counts, green
//               status, pending tasks) — the backend's own statement of coverage,
//               so a reviewer can confirm every plugin carries its features and
//               green marks WITHOUT testing each feature by hand.
// Any signed-in user may read — this is the in-product "about the platform" view.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });

    const stats = catalogStats();
    if (new URL(req.url).searchParams.get("report") === "1") {
      return NextResponse.json({ stats, report: catalogReport() }, { headers: NO_STORE });
    }
    return NextResponse.json({ plugins: PLUGIN_CATALOG, dims: COMPARE_DIMS, stats }, { headers: NO_STORE });
  } catch (e) {
    console.error("[plugins] GET error:", e?.message || e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
