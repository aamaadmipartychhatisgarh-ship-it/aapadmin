import ExcelJS from "exceljs";
import { MLA_COLUMNS, CANDIDATE_COLUMNS, pickCols } from "@/lib/leaderAssessmentColumns";

// Excel export for the MLA Profile and AAP Candidate lists — same rows and the
// SAME column selection as the PDF export, so both files always match the screen.
// (The photo key is PDF-only, so it never produces an Excel column.)
async function buildWorkbook(sheetName, allColumns, rows, cols) {
  const columns = pickCols(allColumns, cols);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF164FA3" } };
  header.alignment = { vertical: "middle" };
  header.height = 20;

  for (const r of rows) {
    const row = ws.addRow(columns.map((c) => c.get(r)));
    columns.forEach((c, i) => {
      if (c.text) { const cell = row.getCell(i + 1); cell.value = String(c.get(r) ?? ""); cell.numFmt = "@"; }
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export function buildMlaListWorkbook(rows, cols) {
  return buildWorkbook("MLA Profiles", MLA_COLUMNS, rows, cols);
}
export function buildCandidateListWorkbook(rows, cols) {
  return buildWorkbook("AAP Candidates", CANDIDATE_COLUMNS, rows, cols);
}
