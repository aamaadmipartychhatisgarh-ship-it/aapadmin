import { renderToBuffer, Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import React from "react";
import { photosToDataUris } from "@/lib/photoDataUri";

// PDF export for the MLA Profile list and the AAP Candidate list. Each row shows
// the record's OWN profile photo, embedded from durable storage (never a broken
// image, never another profile's picture — photos are resolved index-aligned to
// the rows). Text columns differ per list; the photo handling is shared.
const PHOTO_FLEX = 0.7;
const styles = StyleSheet.create({
  page: { padding: 22, fontSize: 8, fontFamily: "Helvetica" },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  subtitle: { fontSize: 9, color: "#555", marginBottom: 10 },
  row: { flexDirection: "row", borderBottom: 1, borderColor: "#eee", paddingVertical: 3, alignItems: "center" },
  headerRow: { backgroundColor: "#164FA3", paddingVertical: 5, alignItems: "center" },
  cell: { paddingHorizontal: 3 },
  cellHeader: { paddingHorizontal: 3, color: "#fff", fontFamily: "Helvetica-Bold" },
  photoWrap: { flex: PHOTO_FLEX, alignItems: "center", justifyContent: "center" },
  photoImg: { width: 28, height: 28, borderRadius: 4, objectFit: "cover" },
  photoPlaceholder: { width: 28, height: 28, borderRadius: 4, backgroundColor: "#E7EDF6", alignItems: "center", justifyContent: "center" },
  photoInitials: { fontSize: 8, color: "#164FA3", fontFamily: "Helvetica-Bold" },
  empty: { marginTop: 16, color: "#888", fontSize: 10 },
});

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
function PhotoCell({ dataUri, name }) {
  if (dataUri) {
    return React.createElement(View, { style: styles.photoWrap },
      React.createElement(Image, { src: dataUri, style: styles.photoImg }));
  }
  return React.createElement(View, { style: styles.photoWrap },
    React.createElement(View, { style: styles.photoPlaceholder },
      React.createElement(Text, { style: styles.photoInitials }, initials(name))));
}

function ListDoc({ title, subtitle, columns, rows, photos, nameKey }) {
  return React.createElement(Document, null,
    React.createElement(Page, { size: "A4", orientation: "landscape", style: styles.page },
      React.createElement(Text, { style: styles.title }, title),
      React.createElement(Text, { style: styles.subtitle }, subtitle),
      React.createElement(View, { style: [styles.row, styles.headerRow] },
        [React.createElement(Text, { key: "ph", style: [styles.cellHeader, { flex: PHOTO_FLEX, textAlign: "center" }] }, "Photo"),
         ...columns.map((c, i) => React.createElement(Text, { key: i, style: [styles.cellHeader, { flex: c.flex }] }, c.header))]),
      rows.length === 0
        ? React.createElement(Text, { style: styles.empty }, "No records to export.")
        : rows.map((r, i) => React.createElement(View, { key: i, style: styles.row, wrap: false },
            [React.createElement(PhotoCell, { key: "ph", dataUri: photos[i], name: r[nameKey] }),
             ...columns.map((col, j) => React.createElement(Text, { key: j, style: [styles.cell, { flex: col.flex }] }, String(col.get(r) ?? "")))]))
    )
  );
}

async function buildListPdf({ title, subtitle, columns, rows, nameKey }) {
  const photos = await photosToDataUris(rows.map((r) => r.photo_url || null));
  return renderToBuffer(React.createElement(ListDoc, { title, subtitle, columns, rows, photos, nameKey }));
}

export async function buildMlaListPdf(rows, subtitle = "") {
  const columns = [
    { header: "Name", flex: 2, get: (m) => m.name || "" },
    { header: "Assembly", flex: 1.8, get: (m) => m.assembly_name || "" },
    { header: "District", flex: 1.4, get: (m) => m.district || "" },
    { header: "Party", flex: 1.6, get: (m) => m.party || "" },
    { header: "Phone", flex: 1.4, get: (m) => m.phone || "" },
    { header: "Score", flex: 0.9, get: (m) => `${m.total ?? 0}/100` },
    { header: "Status", flex: 1, get: (m) => (m.assessment_done ? "Assessed" : "Pending") },
  ];
  return buildListPdf({ title: "MLA Profiles", subtitle, columns, rows, nameKey: "name" });
}

export async function buildCandidateListPdf(rows, subtitle = "") {
  const columns = [
    { header: "Name", flex: 2, get: (c) => c.name || "" },
    { header: "Assembly", flex: 1.8, get: (c) => c.assembly_name || "" },
    { header: "District", flex: 1.4, get: (c) => c.district || "" },
    { header: "Party", flex: 1.6, get: (c) => c.party || "" },
    { header: "Type", flex: 1.4, get: (c) => c.current_position || "AAP Candidate" },
    { header: "Score", flex: 0.9, get: (c) => `${c.total ?? 0}/100` },
    { header: "Status", flex: 1, get: (c) => (c.assessment_done ? "Completed" : "Pending") },
  ];
  return buildListPdf({ title: "AAP Candidates", subtitle, columns, rows, nameKey: "name" });
}
