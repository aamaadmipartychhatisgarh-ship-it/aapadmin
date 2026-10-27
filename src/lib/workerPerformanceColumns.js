// The ONE column configuration of the Worker-wise Performance table. The dashboard table, the
// Excel export and the PDF export are all generated from it, so what is exported is exactly what is
// displayed: add, remove, reorder or hide (visible: false) a column here and all three follow.
//   value(row)  - the plain value shown / exported ("" when unknown)
//   display     - hint for the screen's richer cell ("rank" badge, "name" with its Worker ID line)
//   pdfFlex     - relative width in the PDF
//   numeric     - exported as a number in Excel
export const WORKER_PERFORMANCE_COLUMNS = [
  { key: "rank", label: "Rank", value: (r) => r.rank, display: "rank", pdfFlex: 0.5, numeric: true },
  // The screen shows the Worker ID under the name, so the exported cell carries it too.
  { key: "name", label: "Worker Name", value: (r) => (r.worker_code ? `${r.name} (${r.worker_code})` : r.name || ""), display: "name", pdfFlex: 2.0, bold: true },
  { key: "mobile", label: "Mobile", value: (r) => r.mobile || "", pdfFlex: 1.0 },
  { key: "zone", label: "Zone", value: (r) => r.zone_name || "", pdfFlex: 1.1 },
  { key: "assembly", label: "Assembly", value: (r) => r.assembly_name || "", pdfFlex: 1.3 },
  { key: "workers", label: "Workers", value: (r) => r.new_workers ?? 0, pdfFlex: 0.75, numeric: true },
  { key: "voters", label: "Voters", value: (r) => r.voters ?? 0, pdfFlex: 0.75, numeric: true },
  { key: "total", label: "Total", value: (r) => r.total ?? 0, display: "total", pdfFlex: 0.6, bold: true, numeric: true },
];

export const visibleWorkerColumns = () => WORKER_PERFORMANCE_COLUMNS.filter((c) => c.visible !== false);
