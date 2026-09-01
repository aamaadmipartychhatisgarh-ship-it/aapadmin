import ExcelJS from "exceljs";
import { renderToBuffer, Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import React from "react";

// Excel + PDF export for the Current MLA vs AAP Candidate vote comparison. Both
// are built from the SAME dataset rows the Comparison screen shows (spec §14),
// passed in by the export route — so screen, Excel and PDF always match, and both
// exports honor whatever filter/selection produced those rows (spec §10-§12).

// Indian-grouped number ("82,500"); a missing value renders as the given label
// (never a fake 0 — spec §7).
function num(v, na = "Not Available") {
  if (v == null || v === "") return na;
  const n = Number(v);
  if (!Number.isFinite(n)) return na;
  return n.toLocaleString("en-IN");
}

// The exact export column spec (§10/§11): the seven required fields plus District
// and Election Year for context. `get` returns the display string; `raw` (Excel
// only) returns a real number where one exists so the cell stays numeric/sortable.
const COLUMNS = [
  { header: "District", width: 20, get: (r) => r.district_name || "" },
  { header: "Assembly", width: 24, get: (r) => r.assembly_name || "" },
  { header: "Current MLA", width: 24, get: (r) => r.mla_name || "Not Available" },
  { header: "Current MLA Votes", width: 18, align: "right", raw: (r) => r.mla_votes, get: (r) => num(r.mla_votes) },
  { header: "AAP Candidate", width: 24, get: (r) => r.aap_candidate || "Not Available" },
  { header: "AAP Candidate Votes", width: 18, align: "right", raw: (r) => r.aap_votes, get: (r) => num(r.aap_votes) },
  { header: "Vote Difference", width: 16, align: "right", raw: (r) => r.difference, get: (r) => num(r.difference, "—") },
  { header: "Vote Lead", width: 16, get: (r) => leadLabel(r) },
  { header: "Election Year", width: 13, align: "right", raw: (r) => r.election_year, get: (r) => (r.election_year != null ? String(r.election_year) : "—") },
];

// Human label for the lead column, consistent with the on-screen wording.
function leadLabel(r) {
  if (r.leader === "Current MLA") return "Current MLA";
  if (r.leader === "AAP Candidate") return "AAP Candidate";
  if (r.leader === "Equal") return "Equal Votes";
  return "—"; // incomplete data
}

export async function buildComparisonWorkbookBuffer(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Vote Comparison", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.header, width: c.width }));

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF164FA3" } };
  header.alignment = { vertical: "middle" };
  header.height = 20;

  for (const r of rows) {
    const values = COLUMNS.map((c) => {
      if (c.raw) { const v = c.raw(r); return v == null || v === "" ? c.get(r) : Number(v); }
      return c.get(r);
    });
    const row = ws.addRow(values);
    COLUMNS.forEach((c, i) => {
      if (c.align) row.getCell(i + 1).alignment = { horizontal: c.align };
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

const pdfStyles = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 34, paddingHorizontal: 20, fontSize: 8, fontFamily: "Helvetica" },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  subtitle: { fontSize: 9, color: "#555", marginBottom: 10 },
  headerRow: { flexDirection: "row", backgroundColor: "#164FA3", paddingVertical: 5, alignItems: "center" },
  row: { flexDirection: "row", borderBottom: 1, borderColor: "#eee", paddingVertical: 3, alignItems: "center" },
  rowAlt: { backgroundColor: "#F5F8FD" },
  cell: { paddingHorizontal: 3 },
  cellHeader: { paddingHorizontal: 3, color: "#fff", fontFamily: "Helvetica-Bold" },
  empty: { marginTop: 16, color: "#888", fontSize: 10 },
  footer: {
    position: "absolute", bottom: 16, left: 20, right: 20,
    flexDirection: "row", justifyContent: "space-between",
    fontSize: 7, color: "#888",
  },
});

// PDF column layout — same fields as Excel, minus District (kept in Excel) so the
// seven vote-relevant columns stay legible on a landscape page. Flex widths.
const PDF_COLUMNS = [
  { header: "Assembly", flex: 2.0, get: (r) => r.assembly_name || "" },
  { header: "Current MLA", flex: 2.0, get: (r) => r.mla_name || "Not Available" },
  { header: "MLA Votes", flex: 1.2, align: "right", get: (r) => num(r.mla_votes) },
  { header: "AAP Candidate", flex: 2.0, get: (r) => r.aap_candidate || "Not Available" },
  { header: "AAP Votes", flex: 1.2, align: "right", get: (r) => num(r.aap_votes) },
  { header: "Difference", flex: 1.2, align: "right", get: (r) => num(r.difference, "—") },
  { header: "Vote Lead", flex: 1.3, get: (r) => leadLabel(r) },
];

function ComparisonPdfDoc({ rows, subtitle }) {
  const headerEls = PDF_COLUMNS.map((c, i) =>
    React.createElement(Text, { key: i, style: [pdfStyles.cellHeader, { flex: c.flex, textAlign: c.align || "left" }] }, c.header)
  );
  return React.createElement(Document, null,
    React.createElement(Page, { size: "A4", orientation: "landscape", style: pdfStyles.page, wrap: true },
      React.createElement(Text, { style: pdfStyles.title }, "Current MLA vs AAP Candidate – Vote Comparison"),
      React.createElement(Text, { style: pdfStyles.subtitle }, subtitle),
      // Fixed header repeats at the top of every page.
      React.createElement(View, { style: pdfStyles.headerRow, fixed: true }, headerEls),
      rows.length === 0
        ? React.createElement(Text, { style: pdfStyles.empty }, "No assemblies match the current selection.")
        : rows.map((r, i) => React.createElement(View, {
            key: i, wrap: false, style: i % 2 ? [pdfStyles.row, pdfStyles.rowAlt] : pdfStyles.row,
          },
          PDF_COLUMNS.map((c, j) =>
            React.createElement(Text, { key: j, style: [pdfStyles.cell, { flex: c.flex, textAlign: c.align || "left" }] }, String(c.get(r) ?? ""))
          ))),
      // Fixed footer: org line + page numbers, on every page.
      React.createElement(View, { style: pdfStyles.footer, fixed: true },
        React.createElement(Text, null, "Aam Aadmi Party, Chhattisgarh — Vote Comparison"),
        React.createElement(Text, { render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}` }))
    )
  );
}

export async function buildComparisonPdfBuffer(rows, subtitle = "") {
  const sub = subtitle || `${rows.length} assembl${rows.length === 1 ? "y" : "ies"} · ${new Date().toLocaleString("en-GB")}`;
  return renderToBuffer(React.createElement(ComparisonPdfDoc, { rows, subtitle: sub }));
}

// Timestamped filename (application timezone) for either export.
export function comparisonExportFilename(ext = "xlsx") {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = (t) => parts.find((x) => x.type === t)?.value || "";
  const stamp = `${g("year")}-${g("month")}-${g("day")}_${g("hour")}-${g("minute")}`;
  return `MLA_vs_AAP_Vote_Comparison_${stamp}.${ext}`;
}
