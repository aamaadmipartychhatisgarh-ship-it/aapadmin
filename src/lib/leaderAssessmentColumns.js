// Shared column definitions for the MLA Profile & AAP Candidate list exports, so
// the PDF export, the Excel export and the frontend column picker all agree on
// the exact columns, order, labels and value getters. Kept dependency-free (no
// react-pdf / exceljs imports) so both export builders can import it.

// `flex` drives the PDF column width; `width` drives the Excel column width;
// `text: true` forces an Excel text cell (so a phone keeps leading zeros).
export const MLA_COLUMNS = [
  { key: "name", header: "Name", width: 24, flex: 2, get: (m) => m.name || "" },
  { key: "assembly", header: "Assembly", width: 20, flex: 1.8, get: (m) => m.assembly_name || "" },
  { key: "district", header: "District", width: 16, flex: 1.4, get: (m) => m.district || "" },
  { key: "party", header: "Party", width: 16, flex: 1.6, get: (m) => m.party || "" },
  { key: "phone", header: "Phone", width: 15, flex: 1.4, text: true, get: (m) => m.phone || "" },
  { key: "score", header: "Score", width: 10, flex: 0.9, get: (m) => `${m.total ?? 0}/100` },
  { key: "status", header: "Status", width: 12, flex: 1, get: (m) => (m.assessment_done ? "Assessed" : "Pending") },
];

export const CANDIDATE_COLUMNS = [
  { key: "name", header: "Name", width: 24, flex: 2, get: (c) => c.name || "" },
  { key: "assembly", header: "Assembly", width: 20, flex: 1.8, get: (c) => c.assembly_name || "" },
  { key: "district", header: "District", width: 16, flex: 1.4, get: (c) => c.district || "" },
  { key: "party", header: "Party", width: 16, flex: 1.6, get: (c) => c.party || "" },
  { key: "type", header: "Current Designation", width: 18, flex: 1.6, get: (c) => c.current_position || "" },
  { key: "score", header: "Score", width: 10, flex: 0.9, get: (c) => `${c.total ?? 0}/100` },
  { key: "status", header: "Status", width: 12, flex: 1, get: (c) => (c.assessment_done ? "Completed" : "Pending") },
];

// Photo is a PDF-only visual column (Excel can't embed the profile image), still
// offered in the picker so it can be dropped from the PDF too.
export const PHOTO_KEY = "photo";

// null/undefined → all columns (default). An explicit key list → exactly those
// data columns, in canonical order (the photo key is not a data column).
export function pickCols(all, cols) {
  if (cols == null) return all;
  const set = new Set(cols);
  return all.filter((c) => set.has(c.key));
}

// Frontend picker lists (key + label), each ending with the PDF-only photo.
export const MLA_EXPORT_COLUMNS = [
  ...MLA_COLUMNS.map((c) => ({ key: c.key, label: c.header })),
  { key: PHOTO_KEY, label: "Photo (PDF only)" },
];
export const CANDIDATE_EXPORT_COLUMNS = [
  ...CANDIDATE_COLUMNS.map((c) => ({ key: c.key, label: c.header })),
  { key: PHOTO_KEY, label: "Photo (PDF only)" },
];
