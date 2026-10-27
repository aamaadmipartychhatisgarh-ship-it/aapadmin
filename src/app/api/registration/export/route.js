import { NextResponse } from "next/server";
import { requireRegistrationAccess, NO_STORE, parseRegFilters } from "@/lib/registrationGuard";
import { defaultPeopleSort, getPeoplePage, getWorkerRanking, getBlockRanking } from "@/lib/registrationStats";
import { peopleScopeCond, workerScopeCond } from "@/lib/registrationScope";
import { buildRegistrationPdf, buildWorkerPerformancePdf, registrationPdfFilename } from "@/lib/registrationPdf";
import { isCaller } from "@/lib/permissions";
import * as XLSX from "xlsx";
import { visibleWorkerColumns } from "@/lib/workerPerformanceColumns";

// CSV export of whatever the dashboard is currently showing:
//   ?report=registrations  every person + the worker who added them (default)
//   ?report=workers        worker-wise performance — the same ranked list the
//                          dashboard shows (Top worker_limit, default 200), with
//                          Zone / Assembly from the worker's Contact; &format=pdf too
//   ?report=blocks         block-wise (Area/Booth) performance (Top 100)
//   &format=pdf            (registrations only) the same filtered, scoped list as a PDF
// The SAME filters as the on-screen view are applied, so an export always matches
// the numbers the admin just looked at.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

// Excel opens a CSV cell starting with = + - @ as a formula; prefixing a quote
// neutralises that without changing the visible value.
function csvCell(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  // A UTF-8 BOM so Excel renders Hindi names correctly instead of mojibake.
  return "﻿" + lines.join("\r\n");
}
function fmtDateTime(v) {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("en-IN", { hour12: false });
}

export async function GET(req) {
  try {
    const { session, error } = await requireRegistrationAccess();
    if (error) return error;
    const { searchParams } = new URL(req.url);
    const f = parseRegFilters(searchParams);
    // Zone-wise access control: an export is scoped to the caller's territory too,
    // so a CSV can never be used to pull other zones' records.
    const scope = peopleScopeCond(session);
    const workerScope = workerScopeCond(session, "w");
    const report = searchParams.get("report") || "registrations";
    const stamp = new Date().toISOString().slice(0, 10);

    let csv;
    let filename;
    if (report === "workers") {
      // Exactly the rows the dashboard's Worker-wise Performance shows: same
      // filters, same scope, same ranking order and the same Top-N limit.
      const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("worker_limit") || "200", 10) || 200));
      const rows = await getWorkerRanking({ ...f, limit, workerScope });
      if (searchParams.get("format") === "pdf") {
        const criteria = describeFilters(searchParams, session).filter((c) => !/^(Type|Source|Status):/.test(c));
        criteria.push(`Top ${limit}`);
        const buf = await buildWorkerPerformancePdf(rows, { criteria });
        return new NextResponse(new Uint8Array(buf), {
          status: 200,
          headers: { ...NO_STORE, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${registrationPdfFilename("AAP_Worker_Performance")}"` },
        });
      }
      // Columns = the dashboard table's (one shared configuration), for Excel and CSV alike.
      const cols = visibleWorkerColumns();
      if (searchParams.get("format") === "xlsx") {
        const aoa = [cols.map((c) => c.label), ...rows.map((r) => cols.map((c) => c.value(r)))];
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!cols"] = cols.map((c) => ({ wch: Math.max(c.label.length + 2, c.key === "name" ? 30 : c.numeric ? 10 : 16) }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Worker Performance");
        const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
        return new NextResponse(new Uint8Array(buf), {
          status: 200,
          headers: { ...NO_STORE, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="AAP_Worker_Performance_${stamp}.xlsx"` },
        });
      }
      csv = toCsv(cols.map((c) => c.label), rows.map((r) => cols.map((c) => c.value(r))));
      filename = `AAP_Worker_Performance_${stamp}.csv`;
    } else if (report === "blocks" || report === "wards") {
      // Block-wise (Area / Booth) performance — §9B. `wards` kept as an alias so any
      // old link still resolves to the same Block report.
      const rows = await getBlockRanking({ ...f, limit: 500, scope });
      csv = toCsv(
        ["Rank", "Block (Area/Booth)", "Workers Added", "Voters Added", "Total"],
        rows.map((r) => [r.rank, r.block, r.new_workers, r.voters, r.total])
      );
      filename = `AAP_Block_Performance_${stamp}.csv`;
    } else {
      // Registrations can run to tens of thousands; page through rather than
      // holding one enormous result set open.
      const all = [];
      let page = 1;
      for (;;) {
        const d = await getPeoplePage({ ...f, sort: searchParams.get("sort") || defaultPeopleSort(f.personType), page, pageSize: 500, scope });
        all.push(...d.people);
        if (page >= d.pages || all.length >= 50000) break;
        page += 1;
      }
      if (searchParams.get("format") === "pdf") {
        // A PDF is for reading/printing; very large lists stay in the CSV export.
        const PDF_MAX = 5000;
        const criteria = describeFilters(searchParams, session);
        if (all.length > PDF_MAX) criteria.push(`First ${PDF_MAX.toLocaleString("en-IN")} of ${all.length.toLocaleString("en-IN")} records — use Export CSV for the full list`);
        const buf = await buildRegistrationPdf(all.slice(0, PDF_MAX), { title: "Worker & Voter Registrations", criteria });
        return new NextResponse(new Uint8Array(buf), {
          status: 200,
          headers: { ...NO_STORE, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${registrationPdfFilename()}"` },
        });
      }
      csv = toCsv(
        ["Registration Date & Time", "Type", "Name", "Mobile", "Address", "Constituency", "Ward", "Area/Booth",
         "Wants to be Worker", "Karyakarta Rating", "Added By (Worker)", "Worker Mobile", "Worker ID", "Status"],
        all.map((p) => [
          fmtDateTime(p.registered_at),
          p.person_type === "worker" ? "Wants to be Worker" : "Voter",
          p.name, p.mobile, p.address, p.assembly_name, p.effective_ward || p.ward_number, p.area_booth,
          p.wants_worker ? "Yes" : "No", p.worker_rating != null ? String(p.worker_rating) : "",
          // No karyakarta = arrived through the general /join link.
          p.worker_name || "Direct (/join)", p.worker_mobile, p.worker_code, p.status,
        ])
      );
      filename = `AAP_Registrations_${stamp}.csv`;
    }

    return new NextResponse(csv, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error("[registration] export error:", e);
    return NextResponse.json({ message: "Could not generate the export. Please try again." }, { status: 500, headers: NO_STORE });
  }
}

// The list filters in words, for the PDF header (same params the list uses).
function describeFilters(sp, session) {
  const out = [];
  const period = sp.get("period");
  if (period) out.push(`Period: ${period}`);
  if (sp.get("from") || sp.get("to")) out.push(`Dates: ${sp.get("from") || "…"} – ${sp.get("to") || "…"}`);
  if (sp.get("ward")) out.push(`Ward: ${sp.get("ward")}`);
  const type = sp.get("person_type");
  if (type === "worker") out.push("Type: Workers"); else if (type === "voter") out.push("Type: Voters");
  const source = sp.get("source");
  if (source === "worker") out.push("Source: karyakarta link"); else if (source === "direct") out.push("Source: direct via /join");
  const status = sp.get("status") || "active";
  out.push(`Status: ${status === "active" ? "Counted" : status === "duplicate" ? "Duplicates" : "Rejected"}`);
  if ((sp.get("search") || "").trim()) out.push(`Search: “${sp.get("search").trim()}”`);
  if (sp.get("worker_id")) out.push(`Karyakarta id: ${sp.get("worker_id")}`);
  if (isCaller(session)) out.push("Limited to your assigned area");
  return out;
}
