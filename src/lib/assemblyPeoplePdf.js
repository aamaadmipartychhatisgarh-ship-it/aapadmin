import { renderToBuffer, Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import React from "react";
import { PdfHeader, loadPdfHeaderPhoto, PDF_HEADER_HEIGHT } from "@/lib/pdf/commonHeader";
import { ensureFonts, FONT_FAMILY, cleanPdfText, breakLongTokens } from "@/lib/pdf/generatePdf";

// PDF of the State Overview's "Worker by Assembly" / "Influencer by Assembly" cards, for the filters applied on the card.
//   Page 1 (summary): the totals, the Assembly-wise count table (Rank · Assembly · District · Count — what the chart shows, for the
//                     same filters) with its total, and the "not mapped to an assembly" line when those records are included.
//   Then:             every worker / influencer behind those counts, in ONE table whose column headings repeat on every page, grouped
//                     by Assembly (a heading row per Assembly with its count, never left alone at the foot of a page).
// The counts on page 1 are computed from the SAME rows as the list, so they always reconcile. Hindi names use the bundled Devanagari font.

const dash = (v) => (v == null || String(v).trim() === "" ? "—" : cleanPdfText(v));
const n = (v) => Number(v || 0).toLocaleString("en-IN");
const POTENTIAL = { very_high: "Very High", high: "High", medium: "Medium", low: "Low", very_low: "Very Low" };

export const KINDS = {
  workers: {
    title: "Worker by Assembly", unit: "worker", units: "workers", unitTitle: "Workers",
    cols: [
      { key: "n", label: "#", flex: 0.4, get: (r, i) => String(i) },
      { key: "name", label: "Name", flex: 2, bold: true, get: (r) => dash(r.name) },
      { key: "mobile", label: "Mobile", flex: 1.2, get: (r) => dash(r.mobile) },
      { key: "des", label: "Designation", flex: 2.6, get: (r) => dash(r.designations) },
      { key: "dist", label: "District", flex: 1.3, get: (r) => dash(r.district_name) },
    ],
  },
  influencers: {
    title: "Influencer by Assembly", unit: "influencer", units: "influencers", unitTitle: "Influencers",
    cols: [
      { key: "n", label: "#", flex: 0.4, get: (r, i) => String(i) },
      { key: "name", label: "Name", flex: 1.8, bold: true, get: (r) => dash(r.name) },
      { key: "mobile", label: "Mobile", flex: 1.15, get: (r) => dash(r.mobile) },
      { key: "type", label: "Influence Type", flex: 1.3, get: (r) => dash(r.influence_type) },
      { key: "pos", label: "Influence / Position", flex: 2.2, get: (r) => dash(r.influence_position) },
      { key: "pot", label: "Potential", flex: 0.85, get: (r) => dash(POTENTIAL[r.potential_rating] || r.potential_rating) },
      { key: "dist", label: "District", flex: 1.2, get: (r) => dash(r.district_name) },
    ],
  },
};

const styles = StyleSheet.create({
  page: { paddingTop: PDF_HEADER_HEIGHT + 10, paddingBottom: 32, paddingHorizontal: 22, fontSize: 8 },
  title: { fontSize: 14, fontWeight: 700, color: "#0B3A82", marginBottom: 2 },
  subtitle: { fontSize: 8, color: "#555", marginBottom: 6 },
  criteria: { flexDirection: "row", flexWrap: "wrap", marginBottom: 8 },
  chip: { fontSize: 7.5, color: "#333", backgroundColor: "#EEF3FB", paddingVertical: 2, paddingHorizontal: 5, marginRight: 4, marginBottom: 3, borderRadius: 3 },
  statRow: { flexDirection: "row", marginBottom: 10 },
  stat: { flex: 1, marginRight: 6, paddingVertical: 6, paddingHorizontal: 8, backgroundColor: "#EEF3FB", borderRadius: 4 },
  statLabel: { fontSize: 7.5, color: "#555" },
  statValue: { fontSize: 15, fontWeight: 700, color: "#164FA3", marginTop: 2 },
  section: { fontSize: 10, fontWeight: 700, color: "#164FA3", marginBottom: 4, marginTop: 4 },
  headerRow: { flexDirection: "row", backgroundColor: "#164FA3", paddingVertical: 4 },
  hcell: { paddingHorizontal: 3, color: "#fff", fontWeight: 700 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#E6E9EF", paddingVertical: 3.5 },
  rowAlt: { backgroundColor: "#F6F8FC" },
  cell: { paddingHorizontal: 3 },
  bold: { fontWeight: 700, color: "#111" },
  groupRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "#E3ECF9", borderTopWidth: 1.2, borderColor: "#164FA3", paddingVertical: 4, paddingHorizontal: 4, marginTop: 6 },
  groupText: { fontSize: 9, fontWeight: 700, color: "#0B3A82" },
  totalRow: { flexDirection: "row", backgroundColor: "#EEF3FB", borderTopWidth: 1.5, borderColor: "#164FA3", paddingVertical: 4.5 },
  note: { fontSize: 7.5, color: "#555", marginTop: 6 },
  empty: { marginTop: 14, color: "#888", fontSize: 10 },
  footer: { position: "absolute", bottom: 14, left: 22, right: 22, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: "#888" },
});
const CONTENT_WIDTH = 595 - 44;     // A4 portrait minus side padding

// rows: the people (already filtered, ordered by Assembly). summary: { assemblies: [{ id, assembly, district, count }], unmapped, total,
// showUnmapped, reconciliation? }. criteria: filter chips.
function AssemblyPeopleDoc({ kind, rows, summary, criteria, headerPhoto, stamp }) {
  const K = KINDS[kind];
  const u = ensureFonts() ? { fontFamily: FONT_FAMILY } : {};
  const T = (style, children, extra = {}) => React.createElement(Text, { style: [u, ...[].concat(style)], ...extra }, children);
  const totalFlex = K.cols.reduce((a, c) => a + c.flex, 0);
  const fit = (c, v) => (typeof v === "string" ? breakLongTokens(v, (CONTENT_WIDTH * c.flex / totalFlex - 8) / (8 * 0.62)) : v);
  const footer = () => React.createElement(View, { style: styles.footer, fixed: true },
    T([], `Aam Aadmi Party, Chhattisgarh — ${K.title}`),
    T([], null, { render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}` }));
  const head = (subtitle) => [
    React.createElement(PdfHeader, { key: "h", photo: headerPhoto, subtitle: K.title }),
    T(styles.title, K.title, { key: "t" }),
    T(styles.subtitle, subtitle, { key: "s" }),
    criteria.length ? React.createElement(View, { key: "c", style: styles.criteria }, criteria.map((c, i) => T(styles.chip, cleanPdfText(c), { key: i }))) : null,
  ];
  const sumCols = [
    { key: "rank", label: "Rank", flex: 0.6, get: (a, i) => String(i + 1) },
    { key: "asm", label: "Assembly", flex: 3, bold: true, get: (a) => dash(a.assembly) },
    { key: "dist", label: "District", flex: 2, get: (a) => dash(a.district) },
    { key: "cnt", label: K.unitTitle, flex: 1.1, align: "right", get: (a) => n(a.count) },
  ];
  const al = (c) => (c.align ? { textAlign: c.align } : null);
  const listed = summary.assemblies.reduce((s, a) => s + a.count, 0);

  // Page 1: summary.
  const summaryPage = React.createElement(Page, { key: "sum", size: "A4", style: [styles.page, u], wrap: true },
    ...head(`Assembly-wise ${K.units} for the selected filters · exported ${stamp}`),
    React.createElement(View, { style: styles.statRow, wrap: false },
      [[`Total ${K.unitTitle}`, summary.total], ["In an Assembly", listed], ["Not mapped to an Assembly", summary.showUnmapped ? summary.unmapped : 0], ["Assemblies listed", summary.assemblies.length]].map(([l, v], i) =>
        React.createElement(View, { key: i, style: styles.stat }, T(styles.statLabel, l), T(styles.statValue, n(v))))),
    T(styles.section, "Assembly-wise count"),
    React.createElement(View, { style: styles.headerRow, fixed: true }, sumCols.map((c) => T([styles.hcell, { flex: c.flex }, al(c)].filter(Boolean), c.label, { key: c.key }))),
    summary.assemblies.length === 0 && !summary.showUnmapped
      ? T(styles.empty, "No records match the current filters.")
      : summary.assemblies.map((a, i) => React.createElement(View, { key: a.id, wrap: false, style: i % 2 ? [styles.row, styles.rowAlt] : styles.row },
          sumCols.map((c) => T([styles.cell, { flex: c.flex }, al(c), c.bold ? styles.bold : null].filter(Boolean), fit(c, c.get(a, i)), { key: c.key })))),
    summary.showUnmapped ? React.createElement(View, { style: [styles.row, { backgroundColor: "#FFF7E6" }], wrap: false },
      T([styles.cell, { flex: 0.6 }], "—"), T([styles.cell, { flex: 3 }, styles.bold], "Not mapped to an Assembly"), T([styles.cell, { flex: 2 }], "—"),
      T([styles.cell, { flex: 1.1, textAlign: "right" }], n(summary.unmapped))) : null,
    React.createElement(View, { style: styles.totalRow, wrap: false },
      T([styles.cell, { flex: 0.6 }], ""), T([styles.cell, { flex: 3 }, styles.bold], "Total"), T([styles.cell, { flex: 2 }], ""),
      T([styles.cell, { flex: 1.1, textAlign: "right" }, styles.bold], n(summary.total))),
    summary.reconciliation ? T(styles.note, summary.reconciliation) : null,
    T(styles.note, `The ${K.units} counted above are listed one by one on the following pages, grouped by Assembly.`),
    footer());

  // Following pages: the people, grouped by Assembly (rows arrive ordered by Assembly, unmapped last).
  const body = [];
  let curKey = Symbol("none");
  let idx = 0;
  const groupCount = new Map();
  for (const r of rows) { const k = r.assembly_id ?? "none"; groupCount.set(k, (groupCount.get(k) || 0) + 1); }
  for (const r of rows) {
    const k = r.assembly_id ?? "none";
    if (k !== curKey) {
      curKey = k; idx = 0;
      const c = groupCount.get(k);
      body.push(React.createElement(View, { key: `g${k}`, style: styles.groupRow, wrap: false, minPresenceAhead: 40 },
        T(styles.groupText, r.assembly_name ? `${cleanPdfText(r.assembly_name)}${r.district_name ? `  ·  ${cleanPdfText(r.district_name)}` : ""}` : "Not mapped to an Assembly"),
        T(styles.groupText, `${n(c)} ${c === 1 ? K.unit : K.units}`)));
    }
    idx += 1;
    body.push(React.createElement(View, { key: `r${r.id}`, wrap: false, style: idx % 2 ? styles.row : [styles.row, styles.rowAlt] },
      K.cols.map((c) => T([styles.cell, { flex: c.flex }, c.bold ? styles.bold : null].filter(Boolean), fit(c, c.get(r, idx)), { key: c.key }))));
  }
  const listPage = React.createElement(Page, { key: "list", size: "A4", style: [styles.page, u], wrap: true },
    ...head(`${n(rows.length)} ${rows.length === 1 ? K.unit : K.units}, grouped by Assembly · exported ${stamp}`),
    React.createElement(View, { style: styles.headerRow, fixed: true }, K.cols.map((c) => T([styles.hcell, { flex: c.flex }], c.label, { key: c.key }))),
    rows.length ? body : T(styles.empty, "No records match the current filters."),
    footer());

  return React.createElement(Document, { title: K.title }, summaryPage, listPage);
}

// One row per record id (never twice), order kept.
function uniqueById(rows) {
  const seen = new Set();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

export async function buildAssemblyPeoplePdf(kind, rows, { summary, criteria = [] }) {
  const headerPhoto = await loadPdfHeaderPhoto();
  const stamp = new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata" });
  return renderToBuffer(React.createElement(AssemblyPeopleDoc, { kind, rows: uniqueById(rows), summary, criteria, headerPhoto, stamp }));
}
