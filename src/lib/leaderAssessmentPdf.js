import { renderToBuffer, Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import React from "react";
import { photoToDataUri } from "@/lib/photoDataUri";
import { MLA_COLUMNS, CANDIDATE_COLUMNS, PHOTO_KEY, pickCols } from "@/lib/leaderAssessmentColumns";
import { PdfHeader, loadPdfHeaderPhoto, PDF_HEADER_HEIGHT } from "@/lib/pdf/commonHeader";

// PDF export for the MLA Profile list and the AAP Candidate list. Each row shows
// the record's OWN profile photo, embedded from durable storage (never a broken
// image, never another profile's picture — photos are resolved index-aligned to
// the rows). Text columns differ per list; the photo handling is shared.
const PHOTO_FLEX = 0.7;
const styles = StyleSheet.create({
  page: { paddingTop: PDF_HEADER_HEIGHT + 10, paddingBottom: 22, paddingHorizontal: 22, fontSize: 8, fontFamily: "Helvetica" },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  subtitle: { fontSize: 9, color: "#555", marginBottom: 10 },
  row: { flexDirection: "row", borderBottom: 1, borderColor: "#eee", paddingVertical: 3, alignItems: "center" },
  headerRow: { backgroundColor: "#164FA3", paddingVertical: 5, alignItems: "center" },
  cell: { paddingHorizontal: 3 },
  cellHeader: { paddingHorizontal: 3, color: "#fff", fontFamily: "Helvetica-Bold" },
  photoWrap: { flex: PHOTO_FLEX, alignItems: "center", justifyContent: "center" },
  photoImg: { width: 30, height: 30, borderRadius: 4, objectFit: "contain" },
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

function ListDoc({ title, subtitle, columns, rows, photos, nameKey, includePhoto, headerPhoto }) {
  return React.createElement(Document, null,
    React.createElement(Page, { size: "A4", orientation: "landscape", style: styles.page },
      React.createElement(PdfHeader, { photo: headerPhoto, subtitle: title }),
      React.createElement(Text, { style: styles.title }, title),
      React.createElement(Text, { style: styles.subtitle }, subtitle),
      React.createElement(View, { style: [styles.row, styles.headerRow] },
        [includePhoto && React.createElement(Text, { key: "ph", style: [styles.cellHeader, { flex: PHOTO_FLEX, textAlign: "center" }] }, "Photo"),
         ...columns.map((c, i) => React.createElement(Text, { key: i, style: [styles.cellHeader, { flex: c.flex }] }, c.header))]),
      rows.length === 0
        ? React.createElement(Text, { style: styles.empty }, "No records to export.")
        : rows.map((r, i) => React.createElement(View, { key: i, style: styles.row, wrap: false },
            [includePhoto && React.createElement(PhotoCell, { key: "ph", dataUri: photos[i], name: r[nameKey] }),
             ...columns.map((col, j) => React.createElement(Text, { key: j, style: [styles.cell, { flex: col.flex }] }, String(col.get(r) ?? "")))]))
    )
  );
}

// A PDF-safe (JPEG/PNG) data URI the client already prepared from the exact image
// it displays — canvas output is always JPEG/PNG, so this sidesteps react-pdf's
// lack of WEBP support and guarantees the shown photo. Anything else is ignored.
function clientPhoto(r) {
  const d = r?.photo_data;
  return typeof d === "string" && /^data:image\/(jpeg|jpg|png);base64,/i.test(d) ? d : null;
}

async function buildListPdf({ title, subtitle, columns, rows, nameKey, includePhoto }) {
  // SERVER-SIDE is the authoritative path: read each record's OWN photo bytes from
  // durable storage (by its stored URL/id) and normalize to a PDF-safe PNG. The
  // client-rendered JPEG is only a fallback when the server can't read the bytes.
  // Only resolve photos when the photo column is actually included.
  const photos = includePhoto
    ? await Promise.all(rows.map(async (r) => (await photoToDataUri(r.photo_url)) || clientPhoto(r)))
    : [];
  const embedded = photos.filter(Boolean).length;
  console.log(`[LA PDF] ${title}: ${rows.length} rows, ${columns.length} cols, photo=${includePhoto}, ${embedded} embedded`);
  const headerPhoto = await loadPdfHeaderPhoto();
  return renderToBuffer(React.createElement(ListDoc, { title, subtitle, columns, rows, photos, nameKey, includePhoto, headerPhoto }));
}

// `cols` (optional): null → all columns + photo (unchanged); an explicit key list
// → exactly those columns, with the photo only when its key is included.
export async function buildMlaListPdf(rows, subtitle = "", cols) {
  const columns = pickCols(MLA_COLUMNS, cols);
  const includePhoto = cols == null || cols.includes(PHOTO_KEY);
  return buildListPdf({ title: "MLA Profiles", subtitle, columns, rows, nameKey: "name", includePhoto });
}

export async function buildCandidateListPdf(rows, subtitle = "", cols) {
  const columns = pickCols(CANDIDATE_COLUMNS, cols);
  const includePhoto = cols == null || cols.includes(PHOTO_KEY);
  return buildListPdf({ title: "AAP Candidates", subtitle, columns, rows, nameKey: "name", includePhoto });
}
