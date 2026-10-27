import { renderToBuffer, Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import React from "react";
import { PdfHeader, loadPdfHeaderPhoto, PDF_HEADER_HEIGHT } from "@/lib/pdf/commonHeader";
import { ensureFonts, FONT_FAMILY, cleanPdfText } from "@/lib/pdf/generatePdf";
import { visibleWorkerColumns } from "@/lib/workerPerformanceColumns";

// PDF of Worker / Voter registration records — shared by the admin Registrations
// list and a karyakarta's own "My Voters / My Workers" list. The CALLER decides
// which rows are allowed (each route applies its own access rule before calling
// this); this module only lays them out. Rows are de-duplicated by id.

const fmtDateTime = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
};
const dash = (v) => (v == null || String(v).trim() === "" ? "—" : cleanPdfText(v));

// A4 landscape; flex widths. Long values wrap inside their own cell.
const COLS = [
  { key: "n", label: "#", flex: 0.35, get: (r, i) => String(i + 1) },
  { key: "name", label: "Name", flex: 1.6, get: (r) => dash(r.name), bold: true },
  { key: "type", label: "Type", flex: 0.75, get: (r) => (r.person_type === "worker" ? "Worker" : "Voter") },
  { key: "mobile", label: "Mobile", flex: 0.95, get: (r) => dash(r.mobile) },
  { key: "asm", label: "Constituency", flex: 1.1, get: (r) => dash(r.assembly_name) },
  { key: "ward", label: "Ward / Block", flex: 1.05, get: (r) => dash(r.ward_name || r.effective_ward || r.ward_number) },
  { key: "booth", label: "Area / Booth", flex: 0.9, get: (r) => dash(r.area_booth) },
  { key: "addr", label: "Address", flex: 1.9, get: (r) => dash(r.address) },
  { key: "rating", label: "Rating", flex: 0.5, get: (r) => (r.person_type === "worker" && r.worker_rating != null ? String(r.worker_rating) : "—") },
  { key: "by", label: "Added by", flex: 1.15, get: (r) => (r.worker_name ? cleanPdfText(r.worker_name) : r.added_by_label || "Direct (/join)") },
  { key: "at", label: "Registered", flex: 1.0, get: (r) => fmtDateTime(r.registered_at) },
];

const styles = StyleSheet.create({
  page: { paddingTop: PDF_HEADER_HEIGHT + 10, paddingBottom: 32, paddingHorizontal: 18, fontSize: 7.5, fontFamily: "Helvetica" },
  title: { fontSize: 13, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 8, color: "#555", marginBottom: 6 },
  criteria: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
  chip: { fontSize: 7.5, color: "#333", backgroundColor: "#EEF3FB", paddingVertical: 2, paddingHorizontal: 5, marginRight: 4, marginBottom: 3, borderRadius: 3 },
  headerRow: { flexDirection: "row", backgroundColor: "#164FA3", paddingVertical: 4 },
  hcell: { paddingHorizontal: 3, color: "#fff", fontWeight: 700 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#E6E9EF", paddingVertical: 3.5 },
  rowAlt: { backgroundColor: "#F6F8FC" },
  cell: { paddingHorizontal: 3 },
  bold: { fontWeight: 700, color: "#111" },
  empty: { marginTop: 14, color: "#888", fontSize: 10 },
  footer: { position: "absolute", bottom: 14, left: 18, right: 18, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: "#888" },
});

function RegistrationPdfDoc({ rows, title, subtitle, criteria, headerPhoto, cols = COLS }) {
  const u = ensureFonts() ? { fontFamily: FONT_FAMILY } : {};
  const T = (style, children, extra = {}) => React.createElement(Text, { style: [u, ...[].concat(style)], ...extra }, children);
  return React.createElement(Document, { title },
    React.createElement(Page, { size: "A4", orientation: "landscape", style: [styles.page, u], wrap: true },
      React.createElement(PdfHeader, { photo: headerPhoto, subtitle: title }),
      T(styles.title, title),
      T(styles.subtitle, subtitle),
      criteria?.length ? React.createElement(View, { style: styles.criteria }, criteria.map((c, i) => T(styles.chip, cleanPdfText(c), { key: i }))) : null,
      // Column headings repeat on every page.
      React.createElement(View, { style: styles.headerRow, fixed: true }, cols.map((c) => T([styles.hcell, { flex: c.flex }], c.label, { key: c.key }))),
      rows.length === 0
        ? T(styles.empty, "No records to export for the current selection.")
        : rows.map((r, i) => React.createElement(View, { key: r.id ?? i, wrap: false, style: i % 2 ? [styles.row, styles.rowAlt] : styles.row },
            cols.map((c) => T([styles.cell, { flex: c.flex }, c.bold ? styles.bold : null].filter(Boolean), c.get(r, i), { key: c.key })))),
      React.createElement(View, { style: styles.footer, fixed: true },
        T([], "Aam Aadmi Party, Chhattisgarh — Worker & Voter Registration"),
        T([], null, { render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}` }))
    )
  );
}

// One row per registration id (a record can never appear twice), order kept.
export function uniqueById(rows) {
  const seen = new Set();
  return rows.filter((r) => (r?.id == null ? true : seen.has(r.id) ? false : (seen.add(r.id), true)));
}

export async function buildRegistrationPdf(rows, { title = "Registrations", criteria = [] } = {}) {
  const list = uniqueById(rows);
  const workers = list.filter((r) => r.person_type === "worker").length;
  const subtitle = `${list.length} record${list.length === 1 ? "" : "s"} (${workers} worker${workers === 1 ? "" : "s"} · ${list.length - workers} voter${list.length - workers === 1 ? "" : "s"}) · exported ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })}`;
  const headerPhoto = await loadPdfHeaderPhoto();
  return renderToBuffer(React.createElement(RegistrationPdfDoc, { rows: list, title, subtitle, criteria, headerPhoto }));
}

// Worker-wise Performance (the dashboard ranking): the columns come from the SAME configuration as the
// dashboard table (lib/workerPerformanceColumns), so the PDF holds exactly the displayed columns.
const workerPerfCols = () => visibleWorkerColumns().map((c) => ({ key: c.key, label: c.label, flex: c.pdfFlex || 1, bold: c.bold, get: (r) => dash(c.value(r)) }));

export async function buildWorkerPerformancePdf(rows, { criteria = [] } = {}) {
  const title = "Worker-wise Performance";
  const subtitle = `${rows.length} worker${rows.length === 1 ? "" : "s"} · ranked by total registrations · exported ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })}`;
  const headerPhoto = await loadPdfHeaderPhoto();
  return renderToBuffer(React.createElement(RegistrationPdfDoc, { rows, title, subtitle, criteria, headerPhoto, cols: workerPerfCols() }));
}

export function registrationPdfFilename(prefix = "AAP_Registrations") {
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return `${prefix}_${stamp}.pdf`;
}
