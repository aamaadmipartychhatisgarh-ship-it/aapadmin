import ExcelJS from "exceljs";
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

// Descriptive, timestamped filename (application timezone). `ext` picks the
// extension so the same helper serves both the .xlsx and .csv exports.
export function contactsExportFilename(isSupervisor, ext = "xlsx") {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = (t) => parts.find((x) => x.type === t)?.value || "";
  const stamp = `${g("year")}-${g("month")}-${g("day")}_${g("hour")}-${g("minute")}`;
  return `${isSupervisor ? "Supervisor_Contacts_Export" : "Contacts_Export"}_${stamp}.${ext}`;
}
