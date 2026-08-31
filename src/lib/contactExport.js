import ExcelJS from "exceljs";
import { renderToBuffer, Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import React from "react";
import { query } from "@/lib/db";

// Shared Excel export for the Contacts module (admin + supervisor). Both list
// routes build the SAME WHERE clause + params they use for the on-screen table;
// they hand that straight here, so the export ALWAYS matches exactly what the
// user is looking at (filters, search, status, and — for a supervisor — their
// territory scope, since the scope clause is already baked into `where`).

// One row per contact, with every displayable field resolved in a single query
// (no N+1): geography is the contact's own column when set, else derived from
// the district hierarchy; call stats come from a grouped subquery.
export async function fetchContactExportRows(where, params) {
  return query(
    `SELECT c.*,
            u.username AS assigned_caller_name,
            COALESCE(NULLIF(TRIM(w.position), ''), dsg.name) AS designation_name,
            COALESCE(cz.name, lz.name) AS zone_name,
            COALESCE(cls.name, lls.name) AS lok_sabha_name,
            la.name AS assembly_name,
            ld.name AS district_name,
            cl.total_calls, cl.last_call_date
       FROM contacts c
       LEFT JOIN workers w ON w.id = c.worker_id
       LEFT JOIN users u ON u.id = c.assigned_to_user_id
       LEFT JOIN locations ld ON ld.id = c.district_id
       LEFT JOIN locations lls ON lls.id = ld.parent_id
       LEFT JOIN locations lz ON lz.id = lls.parent_id
       LEFT JOIN locations cz ON cz.id = c.zone_id
       LEFT JOIN locations cls ON cls.id = c.lok_sabha_id
       LEFT JOIN locations la ON la.id = c.assembly_id
       LEFT JOIN designations dsg ON dsg.id = c.designation_id
       LEFT JOIN (
         SELECT contact_id, COUNT(*) AS total_calls, MAX(called_at) AS last_call_date
           FROM calls GROUP BY contact_id
       ) cl ON cl.contact_id = c.id
       ${where}
       ORDER BY c.id DESC`,
    params
  );
}

// "DD-MM-YYYY HH:mm" in the application timezone. `dateOnly` drops the time for
// pure-date columns (e.g. follow-up date) so they don't read "… 05:30".
function fmt(v, dateOnly = false) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t) => parts.find((x) => x.type === t)?.value || "";
  const date = `${g("day")}-${g("month")}-${g("year")}`;
  return dateOnly ? date : `${date} ${g("hour")}:${g("minute")}`;
}

function statusLabel(c) {
  if (c.is_completed) return "Done";
  if (c.assigned_to_user_id) return "Assigned";
  return "Pool";
}

// Column order matches the requested export spec. `text` columns are forced to
// Excel text so phone numbers / pincodes keep leading zeros and never get
// reformatted into scientific notation. Fields with no backing column resolve
// to "" (kept as columns on purpose, per the spec's "show blank if unavailable").
const COLUMNS = [
  { header: "Contact ID", width: 11, get: (c) => c.id },
  { header: "Name", width: 24, get: (c) => c.person_name || "" },
  { header: "Mobile Number", width: 16, text: true, get: (c) => c.phone_number || "" },
  { header: "Alternate Mobile", width: 16, text: true, get: (c) => c.alt_phone_number || c.alternate_mobile || "" },
  { header: "Designation", width: 20, get: (c) => c.designation_name || "" },
  { header: "Zone", width: 15, get: (c) => c.zone_name || "" },
  { header: "Lok Sabha", width: 16, get: (c) => c.lok_sabha_name || "" },
  { header: "Assembly", width: 18, get: (c) => c.assembly_name || "" },
  { header: "District", width: 16, get: (c) => c.district_name || "" },
  { header: "Address", width: 30, get: (c) => c.address || "" },
  { header: "Village/City", width: 18, get: (c) => c.village || "" },
  { header: "Pincode", width: 11, text: true, get: (c) => c.pincode || "" },
  { header: "Status", width: 12, get: (c) => statusLabel(c) },
  { header: "Assigned Caller", width: 18, get: (c) => c.assigned_caller_name || "" },
  { header: "Assigned Supervisor", width: 18, get: (c) => c.assigned_supervisor_name || "" },
  { header: "Created By", width: 16, get: (c) => c.created_by_name || "" },
  { header: "Created Date", width: 19, get: (c) => fmt(c.created_at) },
  { header: "Last Updated", width: 19, get: (c) => fmt(c.updated_at) },
  { header: "Last Call Date", width: 19, get: (c) => fmt(c.last_call_date) },
  { header: "Total Calls", width: 11, number: true, get: (c) => Number(c.total_calls || 0) },
  { header: "Follow-up Date", width: 15, get: (c) => fmt(c.follow_up_date, true) },
  { header: "Complaint Status", width: 16, get: (c) => c.complaint_status || "" },
  { header: "Remarks/Notes", width: 32, get: (c) => c.remarks || "" },
  { header: "VIP", width: 7, get: (c) => (c.is_vip ? "Yes" : "") },
];

// Build the .xlsx as a Buffer: bold white-on-blue header, frozen first row,
// sized columns, phone/pincode as text. Unicode (Hindi) is preserved natively.
export async function buildContactsWorkbookBuffer(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Contacts", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = COLUMNS.map((col) => ({ header: col.header, key: col.header, width: col.width }));

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF164FA3" } };
  header.alignment = { vertical: "middle" };
  header.height = 20;

  for (const c of rows) {
    const row = ws.addRow(COLUMNS.map((col) => col.get(c)));
    COLUMNS.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      if (col.text) { cell.value = String(col.get(c) ?? ""); cell.numFmt = "@"; }
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// Build a UTF-8 CSV string from the SAME COLUMNS as the .xlsx export, so both
// formats are byte-for-byte consistent in content. A leading BOM makes Excel
// open Unicode (Hindi) correctly; RFC-4180 quoting handles commas/quotes/newlines.
export function buildContactsCsv(rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [COLUMNS.map((col) => esc(col.header)).join(",")];
  for (const c of rows) lines.push(COLUMNS.map((col) => esc(col.get(c))).join(","));
  return "\uFEFF" + lines.join("\r\n");
}

// A focused, readable column set for the PDF (the .xlsx keeps every field; a PDF
// page can't fit 24 columns legibly). Covers the spec's requested fields.
const PDF_COLUMNS = [
  { header: "Name", flex: 2, get: (c) => c.person_name || "" },
  { header: "Mobile", flex: 1.5, get: (c) => c.phone_number || "" },
  { header: "Designation", flex: 1.7, get: (c) => c.designation_name || "" },
  { header: "Zone", flex: 1.2, get: (c) => c.zone_name || "" },
  { header: "Lok Sabha", flex: 1.4, get: (c) => c.lok_sabha_name || "" },
  { header: "District", flex: 1.4, get: (c) => c.district_name || "" },
  { header: "Assembly", flex: 1.4, get: (c) => c.assembly_name || "" },
  { header: "Address", flex: 2.2, get: (c) => c.address || "" },
  { header: "Status", flex: 0.9, get: (c) => statusLabel(c) },
];

const pdfStyles = StyleSheet.create({
  page: { padding: 22, fontSize: 8, fontFamily: "Helvetica" },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  subtitle: { fontSize: 9, color: "#555", marginBottom: 10 },
  row: { flexDirection: "row", borderBottom: 1, borderColor: "#eee", paddingVertical: 3 },
  headerRow: { backgroundColor: "#164FA3", paddingVertical: 5 },
  cell: { paddingHorizontal: 3 },
  cellHeader: { paddingHorizontal: 3, color: "#fff", fontFamily: "Helvetica-Bold" },
  empty: { marginTop: 16, color: "#888", fontSize: 10 },
});

function ContactsPdfDoc({ rows, subtitle }) {
  return React.createElement(Document, null,
    React.createElement(Page, { size: "A4", orientation: "landscape", style: pdfStyles.page },
      React.createElement(Text, { style: pdfStyles.title }, "Contacts Export"),
      React.createElement(Text, { style: pdfStyles.subtitle }, subtitle),
      React.createElement(View, { style: [pdfStyles.row, pdfStyles.headerRow] },
        PDF_COLUMNS.map((c, i) => React.createElement(Text, { key: i, style: [pdfStyles.cellHeader, { flex: c.flex }] }, c.header))),
      rows.length === 0
        ? React.createElement(Text, { style: pdfStyles.empty }, "No contacts match the current selection.")
        : rows.map((r, i) => React.createElement(View, { key: i, style: pdfStyles.row, wrap: false },
            PDF_COLUMNS.map((col, j) => React.createElement(Text, { key: j, style: [pdfStyles.cell, { flex: col.flex }] }, String(col.get(r) ?? "")))))
    )
  );
}

// Build the contacts export as a landscape PDF table (same rows the .xlsx/.csv
// use). `subtitle` typically states how many records and whether it's a selected
// or filtered export.
export async function buildContactsPdfBuffer(rows, subtitle = "") {
  const sub = subtitle || `${rows.length} contact${rows.length === 1 ? "" : "s"} · ${new Date().toLocaleString("en-GB")}`;
  return renderToBuffer(React.createElement(ContactsPdfDoc, { rows, subtitle: sub }));
}

// Descriptive, timestamped filename (application timezone). `ext` picks the
// extension so the same helper serves the .xlsx, .csv and .pdf exports.
export function contactsExportFilename(isSupervisor, ext = "xlsx") {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = (t) => parts.find((x) => x.type === t)?.value || "";
  const stamp = `${g("year")}-${g("month")}-${g("day")}_${g("hour")}-${g("minute")}`;
  return `${isSupervisor ? "Supervisor_Contacts_Export" : "Contacts_Export"}_${stamp}.${ext}`;
}
