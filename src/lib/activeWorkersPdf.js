import { renderToBuffer, Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import React from "react";
import { PdfHeader, loadPdfHeaderPhoto, PDF_HEADER_HEIGHT } from "@/lib/pdf/commonHeader";
import { ensureFonts, FONT_FAMILY, cleanPdfText } from "@/lib/pdf/generatePdf";
import { ACTIVE_STATUS_LABEL } from "@/lib/activeStatus";

// PDF of the Active Workers page — the SAME caller groups and worker rows the page
// shows (lib/activeWorkers builds both from one WHERE), every matching record, in
// page order: callers by worker count, each caller's workers in the list order.
// A4 landscape; column headings repeat on every page; a caller heading is never
// left alone at the bottom of a page; long values wrap inside their own cell.

const dash = (v) => (v == null || String(v).trim() === "" ? "—" : cleanPdfText(v));
const statusLabel = (v) => ACTIVE_STATUS_LABEL[v] || "Not set";

const COLS = [
  { key: "n", label: "#", flex: 0.4, get: (r) => String(r._n) },
  { key: "name", label: "Worker Name", flex: 1.6, get: (r) => dash(r.person_name), bold: true },
  { key: "mobile", label: "Mobile", flex: 1.0, get: (r) => dash(r.phone_number) },
  { key: "des", label: "Designation", flex: 2.0, get: (r) => dash(r.designation_name) },
  { key: "district", label: "District", flex: 1.0, get: (r) => dash(r.district_name) },
  { key: "assembly", label: "Assembly", flex: 1.15, get: (r) => dash(r.assembly_name) },
  { key: "block", label: "Block", flex: 1.05, get: (r) => dash(r.block_name) },
  { key: "ws", label: "Worker Status", flex: 0.9, get: (r) => statusLabel(r.active_status) },
  { key: "calling", label: "Calling", flex: 0.65, get: (r) => (Number(r.is_completed) === 1 ? "Done" : "Pending") },
];

const styles = StyleSheet.create({
  page: { paddingTop: PDF_HEADER_HEIGHT + 10, paddingBottom: 30, paddingHorizontal: 18, fontSize: 8, fontFamily: "Helvetica" },
  title: { fontSize: 13, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 8.5, color: "#555", marginBottom: 6 },
  criteria: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
  chip: { fontSize: 7.5, color: "#333", backgroundColor: "#EEF3FB", paddingVertical: 2, paddingHorizontal: 5, marginRight: 4, marginBottom: 3, borderRadius: 3 },
  headerRow: { flexDirection: "row", backgroundColor: "#164FA3", paddingVertical: 4 },
  hcell: { paddingHorizontal: 3, color: "#fff", fontWeight: 700 },
  group: { flexDirection: "row", flexWrap: "wrap", backgroundColor: "#E8EEF8", paddingVertical: 4, paddingHorizontal: 4, marginTop: 4, borderBottomWidth: 1, borderColor: "#C9D6EC" },
  groupName: { fontSize: 9, fontWeight: 700, color: "#0F2F66", marginRight: 8 },
  groupMeta: { fontSize: 7.5, color: "#444" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#E6E9EF", paddingVertical: 3 },
  rowAlt: { backgroundColor: "#F6F8FC" },
  cell: { paddingHorizontal: 3 },
  bold: { fontWeight: 700, color: "#111" },
  empty: { marginTop: 14, color: "#888", fontSize: 10 },
  footer: { position: "absolute", bottom: 12, left: 18, right: 18, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: "#888" },
});

function ActiveWorkersPdfDoc({ groups, title, subtitle, criteria, headerPhoto }) {
  const u = ensureFonts() ? { fontFamily: FONT_FAMILY } : {};
  const T = (style, children, extra = {}) => React.createElement(Text, { style: [u, ...[].concat(style)], ...extra }, children);
  const body = [];
  for (const g of groups) {
    // Caller heading — kept with at least its first worker row (minPresenceAhead).
    body.push(React.createElement(View, { key: `g${g.user_id}`, style: styles.group, wrap: false, minPresenceAhead: 24 },
      T(styles.groupName, `Caller: ${cleanPdfText(g.username)}`),
      T(styles.groupMeta, `Caller status: ${statusLabel(g.active_status)}  ·  ${g.rows.length} worker${g.rows.length === 1 ? "" : "s"}  ·  ${g.pending_count} pending · ${g.done_count} done`)));
    g.rows.forEach((r, i) => {
      body.push(React.createElement(View, { key: `r${r.id}`, wrap: false, style: i % 2 ? [styles.row, styles.rowAlt] : styles.row },
        COLS.map((c) => T([styles.cell, { flex: c.flex }, c.bold ? styles.bold : null].filter(Boolean), c.get(r), { key: c.key }))));
    });
  }
  return React.createElement(Document, { title },
    React.createElement(Page, { size: "A4", orientation: "landscape", style: [styles.page, u], wrap: true },
      React.createElement(PdfHeader, { photo: headerPhoto, subtitle: title }),
      T(styles.title, title),
      T(styles.subtitle, subtitle),
      criteria?.length ? React.createElement(View, { style: styles.criteria }, criteria.map((c, i) => T(styles.chip, cleanPdfText(c), { key: i }))) : null,
      React.createElement(View, { style: styles.headerRow, fixed: true }, COLS.map((c) => T([styles.hcell, { flex: c.flex }], c.label, { key: c.key }))),
      groups.length === 0 ? T(styles.empty, "No active workers match the current filters.") : body,
      React.createElement(View, { style: styles.footer, fixed: true },
        T([], "Aam Aadmi Party, Chhattisgarh — Active Workers"),
        T([], null, { render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}` }))
    )
  );
}

// groups: [{ user_id, username, active_status, pending_count, done_count }] in page
// order; rows: every matching worker. Rows are attached to their caller's group and
// numbered 1..N in output order. A row is never duplicated (de-duplicated by id).
export async function buildActiveWorkersPdf(groups, rows, { criteria = [] } = {}) {
  const seen = new Set();
  const byCaller = new Map();
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    if (!byCaller.has(r.assigned_to_user_id)) byCaller.set(r.assigned_to_user_id, []);
    byCaller.get(r.assigned_to_user_id).push(r);
  }
  let n = 0;
  const out = [];
  for (const g of groups) {
    const list = byCaller.get(g.user_id) || [];
    if (!list.length) continue;
    for (const r of list) r._n = ++n;
    out.push({ ...g, rows: list });
  }
  const title = "Active Workers";
  const subtitle = `${n} worker${n === 1 ? "" : "s"} · ${out.length} caller${out.length === 1 ? "" : "s"} · exported ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })}`;
  const headerPhoto = await loadPdfHeaderPhoto();
  const buffer = await renderToBuffer(React.createElement(ActiveWorkersPdfDoc, { groups: out, title, subtitle, criteria, headerPhoto }));
  return { buffer, count: n };
}

export function activeWorkersPdfFilename() {
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return `Active_Workers_${stamp}.pdf`;
}
