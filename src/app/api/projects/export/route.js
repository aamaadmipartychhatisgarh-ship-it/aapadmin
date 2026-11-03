import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import * as XLSX from "xlsx";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { ensureProjectsSchema, projectsGate, PROJECT_SELECT, projectListWhere, PROJECT_EXPORT_COLUMNS } from "@/lib/projectsModule";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// A cell starting with = + - @ would open as a formula in Excel; a leading quote keeps the visible value.
const safe = (v) => (typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v);

// GET /api/projects/export                      -> the exportable columns {key,label}
// GET /api/projects/export?columns=a,b&type=&q= -> .xlsx with ONLY those columns (always in the list's own column
//     order, whatever order they were ticked), for EVERY project matching the same filters as the list (no page limit).
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    const denied = await projectsGate(session);
    if (denied) return denied;
    const sp = new URL(req.url).searchParams;
    if (!sp.has("columns")) return NextResponse.json({ columns: PROJECT_EXPORT_COLUMNS.map(({ key, label }) => ({ key, label })) }, { headers: NO_STORE });

    const wanted = new Set(String(sp.get("columns") || "").split(",").map((s) => s.trim()).filter(Boolean));
    const unknown = [...wanted].filter((k) => !PROJECT_EXPORT_COLUMNS.some((c) => c.key === k));
    if (unknown.length) return NextResponse.json({ message: `Unknown column: ${unknown[0]}` }, { status: 400, headers: NO_STORE });
    const cols = PROJECT_EXPORT_COLUMNS.filter((c) => wanted.has(c.key));
    if (!cols.length) return NextResponse.json({ message: "Select at least one column to export." }, { status: 400, headers: NO_STORE });

    await ensureProjectsSchema();
    const f = projectListWhere(sp);
    const rows = await query(`${PROJECT_SELECT} ${f.where} ORDER BY p.id DESC`, f.params);
    const seen = new Set(), unique = [];
    for (const r of rows) if (!seen.has(r.id)) { seen.add(r.id); unique.push(r); }     // one row per project
    const aoa = [cols.map((c) => c.label), ...unique.map((r) => cols.map((c) => { const v = c.get(r); return v == null ? "" : safe(v); }))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = cols.map((c) => ({ wch: Math.min(60, Math.max(c.label.length + 2, 14)) }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Projects");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(new Uint8Array(buf), {
      headers: { ...NO_STORE, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="projects.xlsx"`, "X-Export-Count": String(unique.length) },
    });
  } catch (e) { console.error("projects export:", e); return NextResponse.json({ message: "Internal server error" }, { status: 500 }); }
}
