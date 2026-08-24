import { NextResponse as Response } from "next/server";
import * as XLSX from "xlsx";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { getModule } from "@/lib/reports/registry";
import { moduleMeta, runReport } from "@/lib/reports/engine";
import { describeFilters } from "@/lib/reports/describeFilters";
import { reportsGuard as guard } from "@/lib/reports/guard";
import ReportPdfDocument from "@/lib/reports/ReportPdfDocument";
import AnalyticalPdfDocument from "@/lib/reports/AnalyticalPdfDocument";
import { buildAnalytics } from "@/lib/reports/analytical";

export const dynamic = "force-dynamic";

// The PDF renderer holds the whole document tree in memory and is CPU-heavy, so
// the detail PDF is capped to a count it can render WITHOUT risking an OOM /
// resource spike on the production host (the earlier uncapped render was a
// crash risk). Conservative default for stability; raise via env only if the
// host has headroom. The full dataset always stays available via CSV/Excel, and
// the PDF says so when it truncates.
const PDF_MAX_ROWS = Number(process.env.REPORTS_PDF_MAX_ROWS) || 2000;
const PDF_RENDER_TIMEOUT_MS = Number(process.env.REPORTS_PDF_TIMEOUT_MS) || 45000;

// Render a PDF with a hard timeout so the request can never hang forever (which
// left the export button stuck). On timeout we throw a clean, user-facing error.
async function renderPdf(element) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("PDF generation timed out — narrow the filters or use the Excel/CSV export for very large reports.")),
      PDF_RENDER_TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([renderToBuffer(element), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// POST /api/reports/export?format=csv|xlsx|pdf
// Same body shape as POST /api/reports (module, time, filters, geo, search,
// group_by, columns, sort) — page/pageSize are ignored; this always fetches
// the FULL filtered result (up to the engine's export cap), so the file
// matches every row the filters select, not just whatever page is on screen.
export async function POST(req) {
  const { session, error, roleOverride } = await guard();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format");
  if (!["csv", "xlsx", "pdf", "json", "analytical"].includes(format)) {
    return Response.json({ message: "format must be csv, xlsx, pdf, json, or analytical" }, { status: 400 });
  }

  let body;
  try { body = await req.json(); } catch { body = {}; }
  if (!body.module) return Response.json({ message: "module is required" }, { status: 400 });

  const module = getModule(body.module);
  if (!module) return Response.json({ message: "Unknown module" }, { status: 404 });

  // Everything below is wrapped so ANY failure (query, analytics, PDF render,
  // timeout) returns a clean JSON error with the real reason logged — never an
  // HTML 500 page (which breaks the client's JSON parse) and never a hung request.
  try {
    // Analytical PDF — KPIs + per-day chart + breakdown tables, rendered by
    // AnalyticalPdfDocument. Summary-sized, so it's cheap to render.
    if (format === "analytical") {
      const data = await buildAnalytics({ moduleKey: body.module, session, body });
      if (data.error) return Response.json({ message: data.error }, { status: data.status || 400 });
      // Debug: confirm the analytical PDF sees the same data as the on-screen
      // report. If total is 0 while the list has rows, the filters differ
      // (usually a time window on a module whose event date ≠ logged date).
      console.log(
        "[reports] analytical export",
        JSON.stringify({
          module: body.module,
          time: body.time || "all",
          date_from: body.date_from || null,
          date_to: body.date_to || null,
          filters: body.filters || {},
          search: body.search || "",
          total: data.total,
          dimensions: (data.sections || []).length,
        })
      );
      const meta = await moduleMeta(module);
      const filterLines = await describeFilters({ module, meta, body });
      const stamp = new Date().toISOString().slice(0, 10);
      const buffer = await renderPdf(
        React.createElement(AnalyticalPdfDocument, {
          title: module.label,
          subtitle: filterLines.find((l) => l.startsWith("Time:")) || "All time",
          filterLines,
          generatedBy: session.user.username || session.user.name || "—",
          data,
        })
      );
      return pdfResponse(buffer, `${module.key}-analytical-${stamp}.pdf`);
    }

    // The detail PDF caps rows so the renderer always finishes; CSV/Excel fetch
    // the full set.
    const opts = { exportAll: true };
    if (format === "pdf") opts.maxRows = PDF_MAX_ROWS;
    const result = await runReport({ moduleKey: body.module, session, body, opts, roleOverride });
    if (result.error) return Response.json({ message: result.error }, { status: result.status || 400 });
    console.log(
      "[reports] detail export",
      JSON.stringify({
        module: body.module,
        format,
        time: body.time || "all",
        filters: body.filters || {},
        search: body.search || "",
        total: result.total,
        rowsInFile: result.rows?.length || 0,
        truncated: !!result.truncated,
      })
    );

    const meta = await moduleMeta(module);
    const filterLines = await describeFilters({ module, meta, body });
    const stamp = new Date().toISOString().slice(0, 10);
    const filenameBase = `${module.key}-report-${stamp}`;

    if (format === "json") {
      // Backs the dedicated Print view — same full-result-set + filters-used data.
      return Response.json({
        title: module.label,
        filterLines,
        generatedBy: session.user.username || session.user.name || "—",
        generatedAt: new Date().toISOString(),
        result,
      });
    }

    if (format === "csv") {
      const csv = toCsv(result);
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv;charset=utf-8;",
          "Content-Disposition": `attachment; filename="${filenameBase}.csv"`,
        },
      });
    }

    if (format === "xlsx") {
      const data = result.mode === "summary"
        ? result.rows.map((r) => ({ [result.group_label]: r.group_key, Count: r.count }))
        : result.rows.map((row) => Object.fromEntries(result.columns.map((c) => [c.label, formatCell(c, row[c.key])])));
      const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ "": "No records found for the selected filters." }]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, module.label.slice(0, 31));
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      return new Response(buf, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filenameBase}.xlsx"`,
        },
      });
    }

    // PDF
    const orientation = body.orientation === "portrait" ? "portrait" : "landscape";
    const buffer = await renderPdf(
      React.createElement(ReportPdfDocument, {
        title: module.label,
        filterLines,
        generatedBy: session.user.username || session.user.name || "—",
        result,
        orientation,
      })
    );
    return pdfResponse(buffer, `${filenameBase}.pdf`);
  } catch (e) {
    console.error("[reports] export failed:", format, body?.module, e);
    return Response.json(
      { message: e?.message || "Unable to generate the export. Please try again." },
      { status: 500 }
    );
  }
}

function pdfResponse(buffer, filename) {
  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.length),
    },
  });
}

function formatCell(col, v) {
  if (v === null || v === undefined || v === "") return "";
  if (col.type === "bool") return v == 1 ? "Yes" : "No";
  return v;
}

function toCsv(result) {
  const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  let head, lines;
  if (result.mode === "summary") {
    head = [result.group_label, "Count"];
    lines = result.rows.map((r) => [r.group_key, r.count]);
  } else {
    head = result.columns.map((c) => c.label);
    lines = result.rows.map((row) => result.columns.map((c) => formatCell(c, row[c.key])));
  }
  return [head.map(esc).join(","), ...lines.map((l) => l.map(esc).join(","))].join("\n");
}
