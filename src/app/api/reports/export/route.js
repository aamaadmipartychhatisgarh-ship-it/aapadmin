import { NextResponse as Response } from "next/server";
import * as XLSX from "xlsx";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { getModule } from "@/lib/reports/registry";
import { moduleMeta, runReport } from "@/lib/reports/engine";
import { describeFilters } from "@/lib/reports/describeFilters";
import { reportsGuard as guard } from "@/lib/reports/guard";
import ReportPdfDocument from "@/lib/reports/ReportPdfDocument";

export const dynamic = "force-dynamic";

// POST /api/reports/export?format=csv|xlsx|pdf
// Same body shape as POST /api/reports (module, time, filters, geo, search,
// group_by, columns, sort) — page/pageSize are ignored; this always fetches
// the FULL filtered result (up to the engine's export cap), so the file
// matches every row the filters select, not just whatever page is on screen.
export async function POST(req) {
  const { session, error } = await guard();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format");
  if (!["csv", "xlsx", "pdf", "json"].includes(format)) {
    return Response.json({ message: "format must be csv, xlsx, pdf, or json" }, { status: 400 });
  }

  let body;
  try { body = await req.json(); } catch { body = {}; }
  if (!body.module) return Response.json({ message: "module is required" }, { status: 400 });

  const module = getModule(body.module);
  if (!module) return Response.json({ message: "Unknown module" }, { status: 404 });

  const result = await runReport({ moduleKey: body.module, session, body, opts: { exportAll: true } });
  if (result.error) return Response.json({ message: result.error }, { status: result.status || 400 });

  const meta = await moduleMeta(module);
  const filterLines = await describeFilters({ module, meta, body });
  const stamp = new Date().toISOString().slice(0, 10);
  const filenameBase = `${module.key}-report-${stamp}`;

  if (format === "json") {
    // Backs the dedicated Print view (src/app/dashboard/reports/print) — same
    // full-result-set + filters-used data the PDF export uses, as JSON so the
    // print page can render it as clean, printer-friendly HTML instead of a
    // downloaded file.
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
    const ws = XLSX.utils.json_to_sheet(data);
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
  const buffer = await renderToBuffer(
    React.createElement(ReportPdfDocument, {
      title: module.label,
      filterLines,
      generatedBy: session.user.username || session.user.name || "—",
      result,
      orientation,
    })
  );
  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filenameBase}.pdf"`,
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
