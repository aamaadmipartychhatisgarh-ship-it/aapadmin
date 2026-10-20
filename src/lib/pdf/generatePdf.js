import { renderToBuffer, Document, Page, View, Text, Image, StyleSheet, Font } from "@react-pdf/renderer";
import React from "react";
import path from "path";
import { existsSync } from "fs";
import { PdfHeader, loadPdfHeaderPhoto, PDF_HEADER_HEIGHT } from "@/lib/pdf/commonHeader";

// ONE reusable PDF generator for the "Print / PDF Export" feature shared by every
// listed page (Organization Map, Analytics, Tasks, Events, Complaints, Media, …).
// A page hands over a plain description of what it is looking at — a title, an
// optional subtitle/meta line, an optional table (columns + already-formatted
// string rows) and/or one or more chart/map snapshot images — and this builds a
// single, consistent A4 PDF carrying the GLOBAL common header (Kejriwal photo +
// party name) on every page.
//
// Design goals from the ticket:
//   • ONE implementation — no per-page PDF code. Pages only describe their data.
//   • Tables repeat their column header on every page and wrap long text.
//   • Multi-page content flows naturally (rows never split mid-cell).
//   • Charts/maps embed as images so they render meaningfully, never blank.
//   • Empty selections still produce a valid PDF (header + "no records") — never
//     an empty/blank file.
//
// The caller passes CURRENT (already filtered) data, so the PDF always matches
// what is on screen. Access control is enforced at the calling API layer.

const styles = StyleSheet.create({
  page: {
    paddingTop: PDF_HEADER_HEIGHT + 12,
    paddingBottom: 26,
    paddingHorizontal: 22,
    fontSize: 8.5,
    fontFamily: "Helvetica",
    color: "#1a1a1a",
  },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 2, color: "#0B3A82" },
  subtitle: { fontSize: 8.5, color: "#555", marginBottom: 10 },
  sectionTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", color: "#164FA3", marginTop: 8, marginBottom: 4 },
  image: { width: "100%", objectFit: "contain", marginBottom: 10, borderRadius: 4 },
  table: { width: "100%", marginTop: 4 },
  headerRow: { flexDirection: "row", backgroundColor: "#164FA3", paddingVertical: 5 },
  row: { flexDirection: "row", borderBottom: 1, borderColor: "#eee", paddingVertical: 3.5 },
  rowAlt: { backgroundColor: "#F7F9FC" },
  cell: { paddingHorizontal: 4 },
  cellHeader: { paddingHorizontal: 4, color: "#fff", fontFamily: "Helvetica-Bold" },
  empty: { marginTop: 16, color: "#888", fontSize: 10 },
  footer: {
    position: "absolute", bottom: 10, left: 22, right: 22,
    flexDirection: "row", justifyContent: "space-between",
    fontSize: 7, color: "#9ca3af",
  },
});


// ---- Unicode text (Hindi + Latin) --------------------------------------------------
// The built-in PDF fonts (Helvetica) have NO Devanagari glyphs, so Hindi complaint text
// came out as blanks/garbage. Noto Sans Devanagari (OFL; one font that carries both the
// Devanagari and the Latin glyphs, incl. the rupee sign) is bundled in public/fonts and
// read by path like the header photo. A SINGLE family is used on purpose: splitting
// text across two subset fonts that share an internal name makes the PDF library mix
// their glyphs up. If the font files are missing the document still renders (Helvetica).
const FONT_DIR = path.join(process.cwd(), "public", "fonts");
export const FONT_FAMILY = "NotoSansDeva";
let fontsReady = null;
export function ensureFonts() {
  if (fontsReady !== null) return fontsReady;
  try {
    const reg = path.join(FONT_DIR, "NotoSansDevanagari_400Regular.ttf");
    const bold = path.join(FONT_DIR, "NotoSansDevanagari_700Bold.ttf");
    if (!existsSync(reg) || !existsSync(bold)) { fontsReady = false; return false; }
    Font.register({ family: FONT_FAMILY, fonts: [{ src: reg, fontWeight: 400 }, { src: bold, fontWeight: 700 }] });
    // Break only over-long unbroken strings (URLs, ids, "aaaa…") so they wrap inside
    // their box instead of running off the page; normal words are left whole.
    Font.registerHyphenationCallback((word) => {
      if (word.length <= 28) return [word];
      const out = [];
      for (let i = 0; i < word.length; i += 20) out.push(word.slice(i, i + 20));
      return out;
    });
    fontsReady = true;
  } catch (e) {
    console.error("[pdf] font registration failed, using Helvetica:", e?.message || e);
    fontsReady = false;
  }
  return fontsReady;
}
// Style fragment that switches a <Text> to the Unicode font when it is available.
const uni = () => (ensureFonts() ? { fontFamily: FONT_FAMILY } : {});

// Make arbitrary user text safe for the PDF: unify line breaks, drop control chars and
// zero-width noise, and replace pictographs (no glyph in the font) with a visible
// placeholder instead of silently losing or garbling them.
export function cleanPdfText(v) {
  return String(v ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\u200B\uFEFF\uFE0E\uFE0F]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "[?]");
}
const mixedText = cleanPdfText;

// Normalize an incoming column spec into { header, flex, align }.
function normColumns(columns) {
  const list = Array.isArray(columns) ? columns : [];
  return list.map((c) => ({
    header: String(c?.header ?? c?.label ?? ""),
    flex: Number(c?.flex ?? c?.width ?? 1) || 1,
    align: c?.align === "right" || c?.align === "center" ? c.align : "left",
  }));
}

// Coerce one table row (array or object) into an array of display strings that
// lines up with `columns`. Objects are read by column header/key when provided.
function normRow(row, columns, keys) {
  if (Array.isArray(row)) return columns.map((_, i) => cellText(row[i]));
  return columns.map((c, i) => cellText(row?.[keys?.[i] ?? c.header]));
}
function cellText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  return String(v);
}

function Table({ columns, rows, keys }) {
  const cols = normColumns(columns);
  return React.createElement(
    View,
    { style: styles.table },
    // `fixed` makes the column header repeat at the top of every page.
    React.createElement(
      View,
      { style: styles.headerRow, fixed: true },
      cols.map((c, i) =>
        React.createElement(Text, { key: i, style: [styles.cellHeader, { flex: c.flex, textAlign: c.align }] }, c.header)
      )
    ),
    rows.length === 0
      ? React.createElement(Text, { style: styles.empty }, "No records match the current filters.")
      : rows.map((r, ri) => {
          const cells = normRow(r, cols, keys);
          return React.createElement(
            View,
            { key: ri, style: [styles.row, ri % 2 ? styles.rowAlt : null], wrap: false },
            cols.map((c, ci) =>
              React.createElement(Text, { key: ci, style: [styles.cell, { flex: c.flex, textAlign: c.align }] }, cells[ci])
            )
          );
        })
  );
}


// ---- Record cards ----------------------------------------------------------------
// One card per record, for content that does not fit a table cell (long, multiline
// text such as complaint descriptions). The text blocks sit INSIDE their record, wrap
// at the full page width and flow across page breaks without clipping or overlap.
//   records: [{ heading, badge?, fields: [[label, value], …], blocks: [{ label, text }] }]
const rs = StyleSheet.create({
  card: { marginBottom: 10, borderWidth: 1, borderColor: "#D5DEEC", borderRadius: 4 },
  head: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "#EAF0FA", paddingVertical: 5, paddingHorizontal: 8 },
  headText: { fontSize: 10, fontWeight: 700, color: "#0B3A82", flex: 1, paddingRight: 8 },
  badge: { fontSize: 8, fontWeight: 700, color: "#164FA3" },
  fields: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 8, paddingTop: 6 },
  field: { width: "33.33%", paddingRight: 8, marginBottom: 5 },
  label: { fontSize: 6.5, color: "#6b7280", textTransform: "uppercase", marginBottom: 1.5 },
  value: { fontSize: 8.5, color: "#111" },
  block: { paddingHorizontal: 8, paddingBottom: 7 },
  blockText: { fontSize: 9, lineHeight: 1.4, color: "#111", marginTop: 1 },
});
function Records({ records }) {
  return React.createElement(
    View,
    null,
    records.map((r, i) =>
      React.createElement(
        View,
        // Short cards stay whole on one page; only a card with long text (which may be
        // taller than a page) is allowed to flow across page breaks.
        { key: i, style: rs.card, wrap: (r.blocks || []).reduce((n, b) => n + String(b.text || "").length, 0) > 1100 },
        // The card header never sits alone at the bottom of a page.
        React.createElement(
          View,
          { style: rs.head, minPresenceAhead: 60 },
          React.createElement(Text, { style: [rs.headText, uni()] }, mixedText(r.heading)),
          r.badge ? React.createElement(Text, { style: [rs.badge, uni()] }, mixedText(r.badge)) : null
        ),
        React.createElement(
          View,
          { style: rs.fields },
          (r.fields || []).map(([label, value], fi) =>
            React.createElement(
              View,
              { key: fi, style: rs.field, wrap: false },
              React.createElement(Text, { style: [rs.label, uni()] }, cleanPdfText(label)),
              React.createElement(Text, { style: [rs.value, uni()] }, mixedText(value === null || value === undefined || value === "" ? "—" : value))
            )
          )
        ),
        (r.blocks || []).map((b, bi) =>
          React.createElement(
            View,
            { key: bi, style: rs.block },
            React.createElement(Text, { style: [rs.label, uni()] }, cleanPdfText(b.label)),
            // wrap (default) lets a very long description continue on the next page.
            React.createElement(Text, { style: [rs.blockText, uni()] }, mixedText(b.text ? b.text : "—"))
          )
        )
      )
    )
  );
}

function CommonPdfDoc({ title, subtitle, sections, table, images, records, orientation, headerPhoto, generatedBy }) {
  const stamp = new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata" });
  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", orientation: orientation === "portrait" ? "portrait" : "landscape", style: styles.page },
      React.createElement(PdfHeader, { photo: headerPhoto, subtitle: title }),
      React.createElement(Text, { style: styles.title }, title),
      subtitle ? React.createElement(Text, { style: styles.subtitle }, subtitle) : null,

      // Chart/map snapshots (each a full-width image), rendered before the table.
      ...(Array.isArray(images) ? images : [])
        .filter((im) => im && (typeof im === "string" ? im : im.src))
        .map((im, i) => {
          const src = typeof im === "string" ? im : im.src;
          const caption = typeof im === "string" ? null : im.caption;
          return React.createElement(
            View,
            { key: `img${i}`, wrap: false },
            caption ? React.createElement(Text, { style: styles.sectionTitle }, caption) : null,
            React.createElement(Image, { src, style: styles.image })
          );
        }),

      // Record cards (long multiline text that must not be clipped).
      Array.isArray(records) && records.length ? React.createElement(Records, { records }) : null,
      Array.isArray(records) && records.length === 0 && !table ? React.createElement(Text, { style: styles.empty }, "No records match the current filters.") : null,

      // A single primary table (columns + rows).
      table && Array.isArray(table.columns)
        ? React.createElement(
            View,
            null,
            table.title ? React.createElement(Text, { style: styles.sectionTitle }, table.title) : null,
            React.createElement(Table, { columns: table.columns, rows: table.rows || [], keys: table.keys })
          )
        : null,

      // Optional additional tables (e.g. several small breakdowns on one page).
      ...(Array.isArray(sections) ? sections : []).map((s, i) =>
        React.createElement(
          View,
          { key: `sec${i}` },
          s.title ? React.createElement(Text, { style: styles.sectionTitle }, s.title) : null,
          s.columns
            ? React.createElement(Table, { columns: s.columns, rows: s.rows || [], keys: s.keys })
            : s.text
            ? React.createElement(Text, { style: { fontSize: 9, marginBottom: 6 } }, s.text)
            : null
        )
      ),

      React.createElement(
        Text,
        {
          style: styles.footer,
          fixed: true,
          render: ({ pageNumber, totalPages }) =>
            `Aam Aadmi Party Chhattisgarh  ·  Generated ${stamp}${generatedBy ? `  ·  ${generatedBy}` : ""}   —   Page ${pageNumber} / ${totalPages}`,
        }
      )
    )
  );
}

// Build the shared PDF as a Buffer. Payload:
//   { title, subtitle, orientation?, generatedBy?,
//     images?: [dataUri | { src, caption }],
//     records?: [{ heading, badge?, fields:[[label,value]], blocks:[{label,text}] }],
//     table?: { title?, columns:[{header,flex,align}], rows:[[...]|{...}], keys? },
//     sections?: [{ title?, columns?, rows?, keys?, text? }] }
export async function generateCommonPDF(payload = {}) {
  const headerPhoto = await loadPdfHeaderPhoto();
  return renderToBuffer(
    React.createElement(CommonPdfDoc, {
      title: String(payload.title || "Report"),
      subtitle: payload.subtitle ? String(payload.subtitle) : "",
      orientation: payload.orientation,
      generatedBy: payload.generatedBy ? String(payload.generatedBy) : "",
      images: payload.images,
      table: payload.table,
      records: payload.records,
      sections: payload.sections,
      headerPhoto,
    })
  );
}
