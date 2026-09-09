import { NextResponse } from "next/server";
import { requireRegistrationAccess, NO_STORE, parseRegFilters } from "@/lib/registrationGuard";
import { getPeoplePage, getWorkerRanking, getWardRanking } from "@/lib/registrationStats";

// CSV export of whatever the dashboard is currently showing:
//   ?report=registrations  every person + the worker who added them (default)
//   ?report=workers        worker-wise performance
//   ?report=wards          ward-wise performance
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
    const { error } = await requireRegistrationAccess();
    if (error) return error;
    const { searchParams } = new URL(req.url);
    const f = parseRegFilters(searchParams);
    const report = searchParams.get("report") || "registrations";
    const stamp = new Date().toISOString().slice(0, 10);

    let csv;
    let filename;
    if (report === "workers") {
      const rows = await getWorkerRanking({ ...f, limit: 500 });
      csv = toCsv(
        ["Rank", "Worker Name", "Mobile", "Worker ID", "Ward", "Area/Booth", "Voters Added", "Workers Added", "Total", "Link Status"],
        rows.map((r) => [r.rank, r.name, r.mobile, r.worker_code, r.ward_number, r.area_booth, r.voters, r.new_workers, r.total, r.status])
      );
      filename = `AAP_Worker_Performance_${stamp}.csv`;
    } else if (report === "wards") {
      const rows = await getWardRanking({ ...f, limit: 500 });
      csv = toCsv(
        ["Rank", "Ward No.", "Voters Added", "Workers Added", "Total"],
        rows.map((r) => [r.rank, r.ward_number, r.voters, r.new_workers, r.total])
      );
      filename = `AAP_Ward_Performance_${stamp}.csv`;
    } else {
      // Registrations can run to tens of thousands; page through rather than
      // holding one enormous result set open.
      const all = [];
      let page = 1;
      for (;;) {
        const d = await getPeoplePage({ ...f, sort: searchParams.get("sort") || "newest", page, pageSize: 500 });
        all.push(...d.people);
        if (page >= d.pages || all.length >= 50000) break;
        page += 1;
      }
      csv = toCsv(
        ["Registration Date & Time", "Type", "Name", "Mobile", "Address", "Constituency", "Ward", "Area/Booth",
         "Wants to be Worker", "Worker Role", "Added By (Worker)", "Worker Mobile", "Worker ID", "Status"],
        all.map((p) => [
          fmtDateTime(p.registered_at),
          p.person_type === "worker" ? "Wants to be Worker" : "Voter",
          p.name, p.mobile, p.address, p.assembly_name, p.effective_ward || p.ward_number, p.area_booth,
          p.wants_worker ? "Yes" : "No", p.worker_role,
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
