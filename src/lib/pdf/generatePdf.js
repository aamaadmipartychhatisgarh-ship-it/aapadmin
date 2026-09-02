import { renderToBuffer, Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import React from "react";
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

function CommonPdfDoc({ title, subtitle, sections, table, images, orientation, headerPhoto, generatedBy }) {
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
      sections: payload.sections,
      headerPhoto,
    })
  );
}
