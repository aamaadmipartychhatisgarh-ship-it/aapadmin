import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRegistrationAccess, NO_STORE, parseRegFilters } from "@/lib/registrationGuard";
import { defaultPeopleSort, getPeoplePage, getWorkerRanking, workerIdsForLocation, getBlockRanking } from "@/lib/registrationStats";
import { peopleScopeCond, workerScopeCond } from "@/lib/registrationScope";
import { buildRegistrationPdf, buildWorkerPerformancePdf, registrationPdfFilename } from "@/lib/registrationPdf";
import { isCaller } from "@/lib/permissions";
import * as XLSX from "xlsx";
import { visibleWorkerColumns } from "@/lib/workerPerformanceColumns";

// CSV export of whatever the dashboard is currently showing:
//   ?report=registrations  every person + the worker who added them (default)
//   ?report=workers        worker-wise performance — the same ranked list the
//                          dashboard shows, but EVERY matching worker (no Top-N
//                          cut), with Lok Sabha / Assembly from the worker's
//                          Contact; &format=xlsx / &format=pdf too
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
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
}

export async function GET(req) {
  try {
    const { session, error } = await requireRegistrationAccess();
    if (error) return error;
    const { searchParams } = new URL(req.url);
    const f = parseRegFilters(searchParams);
    if (f.dateError) return NextResponse.json({ message: f.dateError }, { status: 400, headers: NO_STORE });
    // Zone-wise access control: an export is scoped to the caller's territory too,
    // so a CSV can never be used to pull other zones' records.
    const scope = peopleScopeCond(session);
    const workerScope = workerScopeCond(session, "w");
    const report = searchParams.get("report") || "registrations";
    const stamp = new Date().toISOString().slice(0, 10);

    let csv;
    let filename;
    if (report === "workers") {
      // The dashboard's Worker-wise Performance rows with the same filters, scope and ranking order — but EVERY matching
      // worker: a downloaded report is never cut to the on-screen Top-N (worker_limit only sizes the dashboard's own list).
      // The same Lok Sabha / Assembly filter as the screen (one resolution, applied in the query).
      const workerIds = await workerIdsForLocation({ campaignId: f.campaignId, lokSabhaId: f.lokSabhaId, assemblyId: f.assemblyId, workerScope });
      // Every worker export (the Workers & Links roster Export / PDF, the Worker-wise Performance Excel / PDF and the Lok Sabha-wise /
      // Assembly-wise PDFs) contains EVERY worker matching its filters.
      let rows;
      {
        // Read in batches of 500 in the list's own order (total, voters, name, then the unique id as the final tie-break, so the order is
        // total and stable); a worker is kept once by id even if the data shifts between batches. No fixed ceiling: it runs until a batch
        // comes back short, so the export keeps working as the number of workers grows.
        rows = []; const seen = new Set();
        for (let off = 0; ; off += 500) {
          const page = await getWorkerRanking({ ...f, limit: 500, offset: off, workerScope, workerIds });
          for (const r of page) if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); }
          if (page.length < 500) break;
        }
      }
      if (searchParams.get("format") === "pdf") {
        const criteria = describeFilters(searchParams, session, f).filter((c) => !/^(Type|Source|Status):/.test(c));
        if (f.lokSabhaId || f.assemblyId) {
          const names = await query(`SELECT id, name FROM locations WHERE id IN (?, ?)`, [f.lokSabhaId || 0, f.assemblyId || 0]);
          const nm = (id) => names.find((n) => Number(n.id) === Number(id))?.name || `#${id}`;
          if (f.lokSabhaId) criteria.push(`Lok Sabha: ${nm(f.lokSabhaId)}`);
          if (f.assemblyId) criteria.push(`Assembly: ${nm(f.assemblyId)}`);
        }
        criteria.push(`All ${rows.length} matching workers`);
        // ?group=lok_sabha | assembly: the Lok Sabha-wise / Assembly-wise PDF - the same filtered rows, preceded by a count summary.
        const group = ["lok_sabha", "assembly"].includes(searchParams.get("group")) ? searchParams.get("group") : null;
        const buf = await buildWorkerPerformancePdf(rows, { criteria, group });
        return new NextResponse(new Uint8Array(buf), {
          status: 200,
          headers: { ...NO_STORE, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${registrationPdfFilename(group === "lok_sabha" ? "AAP_LokSabha_wise_Performance" : group === "assembly" ? "AAP_Assembly_wise_Performance" : "AAP_Worker_Performance")}"` },
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
          headers: { ...NO_STORE, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="AAP_Worker_Performance_${rangeStamp(f.createdFrom, f.createdTo) || stamp}.xlsx"` },
        });
      }
      csv = toCsv(cols.map((c) => c.label), rows.map((r) => cols.map((c) => c.value(r))));
      filename = `AAP_Worker_Performance_${rangeStamp(f.createdFrom, f.createdTo) || stamp}.csv`;
    } else if (report === "blocks" || report === "wards") {
      // Block-wise (Area / Booth) performance — §9B. `wards` kept as an alias so any
      // old link still resolves to the same Block report.
      const rows = await getBlockRanking({ ...f, limit: 500, scope });
      csv = toCsv(
        ["Rank", "Block (Area/Booth)", "Workers Added"],
        rows.map((r) => [r.rank, r.block, r.new_workers])
      );
      filename = `AAP_Block_Performance_${stamp}.csv`;
    } else {
      // Registrations can run to tens of thousands; page through rather than
      // holding one enormous result set open.
      // EVERY matching record (all pages, no cap), read in pages of 500 in the list's own order; a record is kept once by id.
      const all = [];
      const seenP = new Set();
      for (let page = 1; ; page += 1) {
        const d = await getPeoplePage({ ...f, sort: searchParams.get("sort") || defaultPeopleSort(f.personType), page, pageSize: 500, scope });
        for (const p of d.people) if (!seenP.has(p.id)) { seenP.add(p.id); all.push(p); }
        if (page >= d.pages || !d.people.length) break;
      }
      if (searchParams.get("format") === "pdf") {
        const criteria = describeFilters(searchParams, session, f);
        criteria.push(`${all.length.toLocaleString("en-IN")} matching record${all.length === 1 ? "" : "s"}`);
        const buf = await buildRegistrationPdf(all, { title: "Worker Registrations", criteria });
        return new NextResponse(new Uint8Array(buf), {
          status: 200,
          headers: { ...NO_STORE, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${registrationPdfFilename()}"` },
        });
      }
      const regHead = ["Registration Date & Time", "Name", "Mobile", "Address", "Constituency", "Ward", "Area/Booth",
         "User Rating", "Added By (Worker)", "Worker Mobile", "Worker ID", "Status"];
      const regRows = all.map((p) => [
          fmtDateTime(p.registered_at),
          p.name, p.mobile, p.address, p.assembly_name, p.effective_ward || p.ward_number, p.area_booth,
          p.worker_rating != null ? String(p.worker_rating) : "",
          // No karyakarta = arrived through the general /join link.
          p.worker_name || "Direct (/join)", p.worker_mobile, p.worker_code, p.status,
        ]);
      // Excel: the same columns, in the same order, as the CSV.
      if (searchParams.get("format") === "xlsx") {
        const ws = XLSX.utils.aoa_to_sheet([regHead, ...regRows.map((r) => r.map((v) => (v == null ? "" : v)))]);
        ws["!cols"] = regHead.map((h) => ({ wch: Math.max(h.length + 2, /Name|Address|Added By/.test(h) ? 28 : 14) }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Registrations");
        const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
        return new NextResponse(new Uint8Array(buf), {
          status: 200,
          headers: { ...NO_STORE, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="AAP_Registrations_${rangeStamp(f.from, f.to) || stamp}.xlsx"` },
        });
      }
      csv = toCsv(regHead, regRows);
      filename = `AAP_Registrations_${rangeStamp(f.from, f.to) || stamp}.csv`;
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
function describeFilters(sp, session, f = {}) {
  const out = [];
  const period = sp.get("period");
  // The Custom Date Range exactly as applied (one date = that single day), in words.
  if (period === "custom" && f.from) out.push(`Registration date: ${rangeWords(f.from, f.to)}`);
  else if (period && period !== "custom") out.push(`Period: ${PERIOD_WORDS[period] || period}`);
  if (f.createdFrom) out.push(`Worker created: ${rangeWords(f.createdFrom, f.createdTo)}`);
  if (sp.get("ward")) out.push(`Ward: ${sp.get("ward")}`);
  const type = sp.get("person_type");
  if (type === "worker") out.push("Type: Workers"); else if (type === "voter") out.push("Type: Voters");
  const source = sp.get("source");
  if (source === "worker") out.push("Source: user link"); else if (source === "direct") out.push("Source: direct via /join");
  const status = sp.get("status") || "active";
  out.push(`Status: ${status === "active" ? "Counted" : status === "duplicate" ? "Duplicates" : "Rejected"}`);
  if ((sp.get("search") || "").trim()) out.push(`Search: “${sp.get("search").trim()}”`);
  if (sp.get("worker_id")) out.push(`User id: ${sp.get("worker_id")}`);
  if (isCaller(session)) out.push("Limited to your assigned area");
  return out;
}

const PERIOD_WORDS = { today: "Today", yesterday: "Yesterday", week: "This Week", month: "This Month" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayWords = (ymd) => `${ymd.slice(8, 10)} ${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`;
// "05 Mar 2025" for a single day, "01 Mar 2025 – 31 Mar 2025" for a range.
function rangeWords(from, to) {
  return !to || to === from ? dayWords(from) : `${dayWords(from)} – ${dayWords(to)}`;
}
// File-name part for a dated export: "2025-03-05" or "2025-03-01_to_2025-03-31"; "" when no range.
function rangeStamp(from, to) {
  if (!from) return "";
  return !to || to === from ? from : `${from}_to_${to}`;
}
