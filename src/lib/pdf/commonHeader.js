import { readFileSync } from "fs";
import path from "path";
import React from "react";
import { View, Text, Image, StyleSheet } from "@react-pdf/renderer";

// ONE common header for EVERY PDF the app exports (all built with
// @react-pdf/renderer). It shows Arvind Kejriwal Ji's photo next to the party
// name and is rendered `fixed`, so it repeats on every page of a multi-page
// report. Usage in any Document/Page:
//
//   <Page style={{ paddingTop: PDF_HEADER_HEIGHT + 12, ...horizontal/bottom }}>
//     <PdfHeader subtitle="Contacts Export" />   // fixed → all pages
//     ...content...
//   </Page>
//
// The Page MUST carry paddingTop >= PDF_HEADER_HEIGHT so content never overlaps
// the header. The photo is the ONE centralized asset public/kejriwal-header.jpg
// (a small pre-sized thumbnail), read once and cached, so it embeds tiny and can
// never break the PDF. If the asset can't be read, the title still renders
// (never a broken image). `PdfHeader` self-loads the photo, so callers don't
// need to pass anything; an optional `photo` prop lets an async caller inject a
// pre-resolved data URI.

export const PARTY_NAME = "Aam Aadmi Party Chhattisgarh";
export const PDF_HEADER_HEIGHT = 56; // px reserved at the top of every page

const styles = StyleSheet.create({
  header: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    height: PDF_HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    backgroundColor: "#FFFFFF",
    borderBottom: 2,
    borderColor: "#164FA3",
  },
  photo: { width: 34, height: 34, borderRadius: 17, objectFit: "cover", marginRight: 10 },
  photoPlaceholder: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#E7EDF6", marginRight: 10 },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold", color: "#164FA3" },
  sub: { fontSize: 8, color: "#6b7280", marginTop: 1 },
});

// The centralized Kejriwal photo as a data URI — read once (synchronously) from
// the small committed thumbnail and cached for the life of the process.
let _photo; // undefined = not tried; string = data URI; null = unavailable
export function getPdfHeaderPhoto() {
  if (_photo !== undefined) return _photo;
  try {
    const buf = readFileSync(path.join(process.cwd(), "public", "kejriwal-header.jpg"));
    _photo = `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch (e) {
    console.error("[pdfHeader] could not read public/kejriwal-header.jpg:", e?.message || e);
    _photo = null;
  }
  return _photo;
}
// Async alias for builders that already `await` it before rendering.
export async function loadPdfHeaderPhoto() {
  return getPdfHeaderPhoto();
}

// The fixed common header element. `subtitle` is an optional small second line
// (e.g. the report name). `photo` may be passed in; otherwise it self-loads.
export function PdfHeader({ photo, subtitle }) {
  const src = photo !== undefined ? photo : getPdfHeaderPhoto();
  return React.createElement(
    View,
    { fixed: true, style: styles.header },
    src
      ? React.createElement(Image, { src, style: styles.photo })
      : React.createElement(View, { style: styles.photoPlaceholder }),
    React.createElement(
      View,
      null,
      React.createElement(Text, { style: styles.title }, PARTY_NAME),
      subtitle ? React.createElement(Text, { style: styles.sub }, subtitle) : null
    )
  );
}
