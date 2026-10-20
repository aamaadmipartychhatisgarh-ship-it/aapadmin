import ExcelJS from "exceljs";
import { renderToBuffer, Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import React from "react";
import { PdfHeader, loadPdfHeaderPhoto, PDF_HEADER_HEIGHT } from "@/lib/pdf/commonHeader";
import { ensureFonts, FONT_FAMILY, cleanPdfText } from "@/lib/pdf/generatePdf";
import { ASSEMBLY_CATEGORY_LABEL } from "@/lib/assemblyCategoryOptions";

// Excel + PDF (and Print, which prints this PDF) for the MLA Comparison screen.
// Every field the screen shows per assembly is exported, built from the SAME
// dataset rows the screen renders (passed in by the export route), so screen,
// Excel and PDF always match and honour the same filters / selection.
//
// Screen columns → exported fields:
//   Assembly            → Assembly, Category, Election Year, District
//   Current MLA         → Name, Party, Votes
//   Competitor 1/2/3    → Name, Party, Votes (each person's OWN stored party/votes)
//   Vote Lead / Margin  → Winning Margin (or "Tie"), AAP vs BJP, BJP vs Cong

// Indian-grouped number ("82,500") — the screen's toLocaleString("en-IN").
const fmt = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString("en-IN"));

const PEOPLE = [
  { key: "mla", label: "Current MLA", name: (r) => r.mla_name, party: (r) => r.mla_party, votes: (r) => r.mla_votes },
  { key: "c1", label: "Competitor 1", name: (r) => r.competitor1_name, party: (r) => r.competitor1_party, votes: (r) => r.competitor1_votes },
  { key: "c2", label: "Competitor 2", name: (r) => r.competitor2_name, party: (r) => r.competitor2_party, votes: (r) => r.competitor2_votes },
  { key: "c3", label: "Competitor 3", name: (r) => r.competitor3_name, party: (r) => r.competitor3_party, votes: (r) => r.competitor3_votes },
];

const categoryText = (r) => (r.assembly_category ? (ASSEMBLY_CATEGORY_LABEL[r.assembly_category] || r.assembly_category) : null);
// Same wording as the screen's Vote Lead / Margin cell.
function marginText(r) {
  const s = r.vote_stats;
  if (!s) return "—";
  if (s.winner_tie) return "Tie";
  return s.winning_margin == null ? "—" : `${fmt(s.winning_margin)} Votes`;
}
const diffText = (v) => (v == null ? "N/A" : fmt(v));

// ---------------------------------------------------------------- Excel -----
// One flat column per field so every value is its own (sortable) cell.
const XLSX_COLUMNS = [
  { header: "Assembly", width: 24, get: (r) => r.assembly_name || "" },
  { header: "Category", width: 10, get: (r) => categoryText(r) || "" },
  { header: "District", width: 18, get: (r) => r.district_name || "" },
  { header: "Election Year", width: 12, raw: (r) => r.election_year, get: () => "—" },
  ...PEOPLE.flatMap((p) => [
    { header: `${p.label} Name`, width: 22, get: (r) => p.name(r) || "Not Available" },
    { header: `${p.label} Party`, width: 14, get: (r) => p.party(r) || "—" },
    { header: `${p.label} Votes`, width: 14, raw: p.votes, get: () => "—" },
  ]),
  { header: "Winning Margin", width: 16, raw: (r) => (r.vote_stats?.winner_tie ? null : r.vote_stats?.winning_margin), get: (r) => (r.vote_stats?.winner_tie ? "Tie" : "—") },
  { header: "AAP vs BJP", width: 13, raw: (r) => r.vote_stats?.aap_bjp_diff, get: () => "N/A" },
  { header: "BJP vs Cong", width: 13, raw: (r) => r.vote_stats?.bjp_inc_diff, get: () => "N/A" },
];

export async function buildComparisonWorkbookBuffer(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Vote Comparison", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = XLSX_COLUMNS.map((c) => ({ header: c.header, key: c.header, width: c.width }));
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF164FA3" } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 30;
  for (const r of rows) {
    const values = XLSX_COLUMNS.map((c) => {
      if (c.raw) { const v = c.raw(r); return v == null || v === "" ? c.get(r) : Number(v); }
      return c.get(r);
    });
    const row = ws.addRow(values);
    XLSX_COLUMNS.forEach((c, i) => { if (c.raw) row.getCell(i + 1).alignment = { horizontal: "right" }; });
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ------------------------------------------------------------------ PDF -----
const BRAND = "#164FA3";
const styles = StyleSheet.create({
  page: { paddingTop: PDF_HEADER_HEIGHT + 10, paddingBottom: 34, paddingHorizontal: 18, fontSize: 7.5, fontFamily: "Helvetica" },
  title: { fontSize: 13, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 8, color: "#555", marginBottom: 6 },
  criteria: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
  chip: { fontSize: 7.5, color: "#333", backgroundColor: "#EEF3FB", paddingVertical: 2, paddingHorizontal: 5, marginRight: 4, marginBottom: 3, borderRadius: 3 },
  cards: { flexDirection: "row", marginBottom: 8 },
  card: { flex: 1, borderWidth: 1, borderColor: "#E3E8F0", borderRadius: 4, paddingVertical: 4, paddingHorizontal: 6, marginRight: 5 },
  cardValue: { fontSize: 11, fontWeight: 700 },
  cardLabel: { fontSize: 7, color: "#666" },
  cardHint: { fontSize: 6.5, color: "#444", marginTop: 1 },
  headerRow: { flexDirection: "row", backgroundColor: BRAND, paddingVertical: 4, alignItems: "flex-end" },
  hcell: { paddingHorizontal: 3, color: "#fff", fontWeight: 700, fontSize: 7.5 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#E6E9EF", paddingVertical: 4 },
  rowAlt: { backgroundColor: "#F6F8FC" },
  cell: { paddingHorizontal: 3 },
  strong: { fontWeight: 700, color: "#111" },
  mlaName: { fontWeight: 700, color: BRAND },
  muted: { color: "#666", fontSize: 7 },
  na: { color: "#999" },
  margin: { fontWeight: 700, color: BRAND },
  tie: { fontWeight: 700, color: "#B45309" },
  empty: { marginTop: 14, color: "#888", fontSize: 10 },
  footer: { position: "absolute", bottom: 14, left: 18, right: 18, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: "#888" },
});

// Column widths (flex) on an A4 landscape page — all screen columns fit without
// horizontal scrolling; long names wrap inside their own cell.
const COLS = [
  { key: "assembly", label: "Assembly", flex: 1.55 },
  ...PEOPLE.map((p) => ({ key: p.key, label: p.label, flex: p.key === "mla" ? 1.6 : 1.45, person: p })),
  { key: "margin", label: "Vote Lead / Margin", flex: 1.25 },
];

const T = (style, children, extra = {}) => React.createElement(Text, { style, ...extra }, children);

function PersonCell({ p, r, u }) {
  const name = p.name(r), party = p.party(r), votes = fmt(p.votes(r));
  return React.createElement(View, null,
    T([u, name ? (p.key === "mla" ? styles.mlaName : styles.strong) : styles.na], name ? cleanPdfText(name) : "Not Available"),
    T([u, styles.muted], party ? cleanPdfText(party) : "—"),
    T(u, votes != null ? `${votes} votes` : "—"));
}

function ComparisonPdfDoc({ rows, subtitle, criteria, summary, headerPhoto }) {
  const u = ensureFonts() ? { fontFamily: FONT_FAMILY } : {};
  const headerEls = COLS.map((c) => T([styles.hcell, u, { flex: c.flex }], c.label, { key: c.key }));
  const cards = summary ? [
    ["Total Assemblies", summary.total_assemblies, "#111"],
    ["Total BJP Votes", summary.bjp_total, "#FF6634"],
    ["Total INC Votes", summary.inc_total, "#19AAF8"],
    ["Total AAP Votes", summary.aap_total, "#059669"],
    ["AAP vs BJP Margin", summary.aap_bjp_margin, "#D97706",
      summary.margin_leader === "BJP" ? `BJP Ahead by ${fmt(summary.aap_bjp_margin)}` : summary.margin_leader === "AAP" ? `AAP Ahead by ${fmt(summary.aap_bjp_margin)}` : "Equal Votes"],
  ] : [];
  return React.createElement(Document, { title: "MLA Comparison" },
    React.createElement(Page, { size: "A4", orientation: "landscape", style: [styles.page, u], wrap: true },
      React.createElement(PdfHeader, { photo: headerPhoto, subtitle: "Current MLA vs Competitors — Vote Comparison" }),
      T([styles.title, u], "Current MLA vs Competitors — Vote Comparison"),
      T([styles.subtitle, u], subtitle),
      criteria.length ? React.createElement(View, { style: styles.criteria }, criteria.map((c, i) => T([styles.chip, u], cleanPdfText(c), { key: i }))) : null,
      cards.length ? React.createElement(View, { style: styles.cards, wrap: false }, cards.map(([label, value, color, hint], i) =>
        React.createElement(View, { key: i, style: [styles.card, i === cards.length - 1 ? { marginRight: 0 } : null] },
          T([styles.cardValue, u, { color }], fmt(value ?? 0) || "0"),
          T([styles.cardLabel, u], label),
          hint ? T([styles.cardHint, u], hint) : null))) : null,
      // Column header repeats at the top of every page.
      React.createElement(View, { style: styles.headerRow, fixed: true }, headerEls),
      rows.length === 0
        ? T([styles.empty, u], "No assemblies match the current selection.")
        : rows.map((r, i) => React.createElement(View, { key: r.assembly_id ?? i, wrap: false, style: i % 2 ? [styles.row, styles.rowAlt] : styles.row },
            COLS.map((c) => {
              let content;
              if (c.person) content = React.createElement(PersonCell, { p: c.person, r, u });
              else if (c.key === "assembly") {
                const meta = [categoryText(r), r.election_year ? String(r.election_year) : null].filter(Boolean).join(" · ");
                content = React.createElement(View, null,
                  T([styles.strong, u], cleanPdfText(r.assembly_name || "—")),
                  meta ? T([styles.muted, u], meta) : null,
                  T([styles.muted, u], cleanPdfText(r.district_name || "—")));
              } else {
                const m = marginText(r);
                content = React.createElement(View, null,
                  T([m === "Tie" ? styles.tie : styles.margin, u], m),
                  T([styles.muted, u], `AAP vs BJP: ${diffText(r.vote_stats?.aap_bjp_diff)}`),
                  T([styles.muted, u], `BJP vs Cong: ${diffText(r.vote_stats?.bjp_inc_diff)}`));
              }
              return React.createElement(View, { key: c.key, style: [styles.cell, { flex: c.flex }] }, content);
            }))),
      React.createElement(View, { style: styles.footer, fixed: true },
        T(u, "Aam Aadmi Party, Chhattisgarh — MLA Comparison"),
        T(u, null, { render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}` }))
    )
  );
}

// Summary cards for exactly the exported rows — per-assembly party totals summed
// once each (the same canonical party rule the screen's cards use).
export function summarizeComparisonRows(rows) {
  let bjp = 0, inc = 0, aap = 0;
  for (const r of rows) {
    bjp += Number(r.vote_stats?.bjp_total) || 0;
    inc += Number(r.vote_stats?.inc_total) || 0;
    aap += Number(r.vote_stats?.aap_total) || 0;
  }
  return {
    total_assemblies: rows.length, bjp_total: bjp, inc_total: inc, aap_total: aap,
    aap_bjp_margin: Math.abs(bjp - aap), margin_leader: bjp > aap ? "BJP" : aap > bjp ? "AAP" : "Equal",
  };
}

export async function buildComparisonPdfBuffer(rows, { subtitle = "", criteria = [], summary = null } = {}) {
  const sub = subtitle || `${rows.length} assembl${rows.length === 1 ? "y" : "ies"} · ${new Date().toLocaleString("en-GB")}`;
  const headerPhoto = await loadPdfHeaderPhoto();
  return renderToBuffer(React.createElement(ComparisonPdfDoc, { rows, subtitle: sub, criteria, summary: summary || summarizeComparisonRows(rows), headerPhoto }));
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
