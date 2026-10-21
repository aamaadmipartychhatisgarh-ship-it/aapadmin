import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { ACTIVE_STATUS_LABEL } from "@/lib/activeStatus";
import { parseActiveWorkerFilters, fetchActiveWorkerGroups, fetchActiveWorkerRows } from "@/lib/activeWorkers";
import { buildActiveWorkersPdf, activeWorkersPdfFilename } from "@/lib/activeWorkersPdf";

// GET /api/contacts/active-workers/export?format=pdf&<the page's filters>
// Exports EVERY active worker matching the page's current filters + search (never
// just what is expanded/visible), using the same query, scope and order as the
// page, so the file matches the screen. Same access rule as the page itself.
export const dynamic = "force-dynamic";
const MAX_ROWS = 20000;

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "contacts", session && isSupervisor(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const format = (searchParams.get("format") || "pdf").toLowerCase();
    if (format !== "pdf") return NextResponse.json({ message: "Unsupported format." }, { status: 400 });
    const f = parseActiveWorkerFilters(searchParams);

    const { groups, total } = await fetchActiveWorkerGroups(session, f);
    // Refuse rather than silently truncating an export that is too large to render.
    if (total > MAX_ROWS) {
      return NextResponse.json({ message: `${total.toLocaleString("en-IN")} workers match — narrow the filters to export at most ${MAX_ROWS.toLocaleString("en-IN")} at a time.` }, { status: 413 });
    }
    const rows = await fetchActiveWorkerRows(session, f);
    const { buffer, count } = await buildActiveWorkersPdf(groups, rows, { criteria: await describeFilters(f) });
    if (count !== total) console.warn(`[active-workers export] rows ${count} != group total ${total}`);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${searchParams.get("disposition") === "inline" ? "inline" : "attachment"}; filename="${activeWorkersPdfFilename()}"`,
        "Cache-Control": "no-store",
        "X-Export-Count": String(count),
      },
    });
  } catch (err) {
    console.error("active-workers export error:", err);
    return NextResponse.json({ message: "Export failed." }, { status: 500 });
  }
}

// The applied filters in words, for the PDF header ("Assembly: Abhanpur", …).
async function describeFilters(f) {
  const out = [];
  const name = async (table, id) => (await query(`SELECT name FROM ${table} WHERE id = ?`, [id]))[0]?.name || `#${id}`;
  if (f.district_id) out.push(`District: ${await name("locations", f.district_id)}`);
  if (f.assembly_id) out.push(`Assembly: ${await name("locations", f.assembly_id)}`);
  if (f.block_id) out.push(`Block: ${await name("locations", f.block_id)}`);
  if (f.designation_id) out.push(`Designation: ${await name("designations", f.designation_id)}`);
  if (f.worker_status) out.push(`Worker Status: ${ACTIVE_STATUS_LABEL[f.worker_status]}`);
  if (f.status) out.push(`Caller Status: ${ACTIVE_STATUS_LABEL[f.status]}`);
  if (f.search) out.push(`Search: "${f.search}"`);
  if (!out.length) out.push("All active workers (no filters)");
  return out;
}
