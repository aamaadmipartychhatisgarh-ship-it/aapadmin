import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { workerPeopleByAssembly, workerAssemblyReconciliation } from "@/lib/workerCounts";
import { influencerPeopleByAssembly } from "@/lib/influencerCounts";
import { buildAssemblyPeoplePdf, KINDS } from "@/lib/assemblyPeoplePdf";

// GET /api/dashboard/assembly-breakdown/people?kind=workers|influencers&assembly=<id|none>&q=<search>&format=json|pdf
// The State Overview's "Worker by Assembly" / "Influencer by Assembly" cards, for the filters applied on the card:
//   format=json — the Assembly-wise counts for those filters (the card's chart when a filter is set);
//   format=pdf  — the PDF: the Assembly-wise count table + every worker / influencer behind it, grouped by Assembly.
// Both come from ONE list of records (lib/workerCounts.workerPeopleByAssembly / lib/influencerCounts.influencerPeopleByAssembly — the same
// rules as the unfiltered chart), so the counts and the list always agree and every matching record is included (no paging, no cap).
// Same access gate as /api/dashboard/assembly-breakdown.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "analytics", session && isOversight(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const sp = new URL(req.url).searchParams;
    const kind = sp.get("kind") === "influencers" ? "influencers" : sp.get("kind") === "workers" ? "workers" : null;
    if (!kind) return NextResponse.json({ message: "kind must be workers or influencers." }, { status: 400, headers: NO_STORE });
    const rawAsm = (sp.get("assembly") || "").trim();
    const assemblyId = rawAsm === "none" ? "none" : /^\d+$/.test(rawAsm) ? Number(rawAsm) : null;
    if (rawAsm && assemblyId === null) return NextResponse.json({ message: "Invalid Assembly." }, { status: 400, headers: NO_STORE });
    const search = (sp.get("q") || "").trim().slice(0, 100);

    const asmRows = await query(
      `SELECT a.id, a.name, d.name AS district FROM locations a LEFT JOIN locations d ON d.id = a.parent_id AND d.type = 'district'
        WHERE a.type = 'assembly' ORDER BY a.name ASC`
    );
    let selectedName = null;
    if (typeof assemblyId === "number") {
      selectedName = asmRows.find((a) => Number(a.id) === assemblyId)?.name || null;
      if (!selectedName) return NextResponse.json({ message: "That Assembly does not exist." }, { status: 404, headers: NO_STORE });
    }

    const rows = kind === "workers"
      ? await workerPeopleByAssembly({ assemblyId, search })
      : await influencerPeopleByAssembly({ assemblyId, search });

    // Assembly-wise counts from the SAME rows. Unfiltered / one Assembly: every Assembly in scope is listed (zero included, as the chart);
    // with a search only the Assemblies that have a match.
    const byAsm = new Map();
    let unmapped = 0;
    for (const r of rows) { if (r.assembly_id == null) unmapped++; else byAsm.set(Number(r.assembly_id), (byAsm.get(Number(r.assembly_id)) || 0) + 1); }
    let assemblies = asmRows
      .filter((a) => (typeof assemblyId === "number" ? Number(a.id) === assemblyId : assemblyId === "none" ? false : true))
      .map((a) => ({ id: a.id, assembly: a.name, district: a.district || null, count: byAsm.get(Number(a.id)) || 0 }));
    if (search) assemblies = assemblies.filter((a) => a.count > 0);
    assemblies.sort((x, y) => y.count - x.count || String(x.assembly).localeCompare(String(y.assembly)));
    const showUnmapped = assemblyId === "none" || (assemblyId === null && (!search || unmapped > 0));

    if (sp.get("format") !== "pdf") {
      return NextResponse.json({ kind, rows: assemblies.map((a) => ({ id: a.id, assembly: a.assembly, value: a.count })), total: rows.length, unmapped: showUnmapped ? unmapped : 0, show_unmapped: showUnmapped }, { headers: NO_STORE });
    }

    const K = KINDS[kind];
    const criteria = [
      `Assembly: ${assemblyId === "none" ? "Not mapped to an Assembly" : selectedName || "All Assemblies"}`,
      `Search: ${search ? `“${search}”` : "—"}`,
      `${rows.length.toLocaleString("en-IN")} ${rows.length === 1 ? K.unit : K.units}`,
    ];
    let reconciliation = null;
    if (!search && assemblyId === null) {
      const inAsm = assemblies.reduce((s, a) => s + a.count, 0);
      reconciliation = `Total ${K.units} ${rows.length.toLocaleString("en-IN")} = in an Assembly ${inAsm.toLocaleString("en-IN")} + not mapped to an Assembly ${unmapped.toLocaleString("en-IN")}.`;
      if (kind === "workers") {
        const rec = await workerAssemblyReconciliation().catch(() => null);
        if (rec?.duplicates_excluded) reconciliation += ` Counted once per person: ${rec.duplicates_excluded.toLocaleString("en-IN")} repeat contact record(s) of the same number not counted.`;
      }
    }
    const buf = await buildAssemblyPeoplePdf(kind, rows, { summary: { assemblies, unmapped, total: rows.length, showUnmapped, reconciliation }, criteria });
    const slug = (s) => String(s || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const name = `${kind === "workers" ? "Worker" : "Influencer"}_by_Assembly${selectedName ? `_${slug(selectedName)}` : assemblyId === "none" ? "_Not_Mapped" : ""}${search ? `_search_${slug(search).slice(0, 30)}` : ""}_${new Date().toISOString().slice(0, 10)}.pdf`;
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: { ...NO_STORE, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"` },
    });
  } catch (err) {
    console.error("[assembly-breakdown/people] GET error:", err?.message || err);
    return NextResponse.json({ message: "Could not generate the report. Please try again." }, { status: 500, headers: NO_STORE });
  }
}
