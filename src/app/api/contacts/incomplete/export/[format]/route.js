import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { fetchIncompleteDesignation, normalizeLevel, LEVEL_LABEL } from "@/lib/incompleteDesignations";
import * as XLSX from "xlsx";
import { renderToBuffer, Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { PdfHeader, PDF_HEADER_HEIGHT } from "@/lib/pdf/commonHeader";
import React from "react";

// GET /api/contacts/incomplete/export/xlsx|pdf?level=&designation_id=&location_id=&status=
// Exports EXACTLY the currently displayed/filtered Incomplete-Designation rows.
// It calls the same shared data layer as the page with the same params, so the
// file always matches the on-screen table (level, designation, location, and
// filled/blank filter all honoured — never the whole unfiltered database).
export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "contacts", session && isAdmin(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { format } = await params;
    if (format !== "xlsx" && format !== "pdf") {
      return NextResponse.json({ message: "Unsupported format" }, { status: 404 });
    }
    const { searchParams } = new URL(req.url);
    const level = normalizeLevel(searchParams.get("level"));
    if (!level) return NextResponse.json({ message: "Invalid level." }, { status: 400 });

    const data = await fetchIncompleteDesignation(session, {
      level,
      designationId: parseInt(searchParams.get("designation_id"), 10),
      locationId: parseInt(searchParams.get("location_id"), 10),
      status: searchParams.get("status"),
    });

    const levelLabel = LEVEL_LABEL[level] || level;
    const stamp = new Date().toISOString().slice(0, 10);
    const statusLabel = data.status === "filled" ? "Filled" : data.status === "blank" ? "Blank" : "All";
    const rows = data.rows.map((r) => ({
      location: r.location_name,
      designation: r.designation_name,
      person: r.filled ? r.person_names : "Not Assigned",
      status: r.filled ? "Filled" : "Blank",
    }));

    if (format === "xlsx") {
      const sheet = rows.map((r) => ({
        [`${levelLabel} Location`]: r.location,
        Designation: r.designation,
        "Assigned Person": r.person,
        Status: r.status,
      }));
      // Guarantee a header row even when there are zero records.
      const ws = sheet.length
        ? XLSX.utils.json_to_sheet(sheet)
        : XLSX.utils.aoa_to_sheet([[`${levelLabel} Location`, "Designation", "Assigned Person", "Status"]]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Incomplete Designation");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      return new Response(buf, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="incomplete-designation-${level}-${data.status}-${stamp}.xlsx"`,
        },
      });
    }

    const subtitle = `${levelLabel} level · ${statusLabel} · Total ${data.counts.total} · Filled ${data.counts.filled} · Blank ${data.counts.blank} · ${new Date().toLocaleString("en-GB")}`;
    const buffer = await renderToBuffer(
      React.createElement(Doc, { rows, levelLabel, subtitle })
    );
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="incomplete-designation-${level}-${data.status}-${stamp}.pdf"`,
      },
    });
  } catch (err) {
    console.error("incomplete designation export error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

const styles = StyleSheet.create({
  page: { paddingTop: PDF_HEADER_HEIGHT + 10, paddingBottom: 24, paddingHorizontal: 24, fontSize: 9, fontFamily: "Helvetica" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  subtitle: { fontSize: 9, color: "#555", marginBottom: 12 },
  row: { flexDirection: "row", borderBottom: 1, borderColor: "#eee", paddingVertical: 4 },
  headerRow: { backgroundColor: "#0B3A82", paddingVertical: 6 },
  cell: { paddingHorizontal: 4 },
  cellHeader: { paddingHorizontal: 4, color: "#fff", fontFamily: "Helvetica-Bold" },
  empty: { marginTop: 16, color: "#888", fontSize: 10 },
});
function Doc({ rows, levelLabel, subtitle }) {
  const COLS = [
    { key: "location", label: `${levelLabel} Location`, flex: 2 },
    { key: "designation", label: "Designation", flex: 2 },
    { key: "person", label: "Assigned Person", flex: 2 },
    { key: "status", label: "Status", flex: 0.8 },
  ];
  return React.createElement(Document, null,
    React.createElement(Page, { size: "A4", style: styles.page },
      React.createElement(PdfHeader, { subtitle: "Incomplete Designation" }),
      React.createElement(Text, { style: styles.title }, "Incomplete Designation"),
      React.createElement(Text, { style: styles.subtitle }, subtitle),
      React.createElement(View, { style: [styles.row, styles.headerRow] },
        COLS.map((c, i) => React.createElement(Text, { key: i, style: [styles.cellHeader, { flex: c.flex }] }, c.label))),
      rows.length === 0
        ? React.createElement(Text, { style: styles.empty }, "No records match the current filters.")
        : rows.map((r, i) => React.createElement(View, { key: i, style: styles.row, wrap: false },
            COLS.map((c, j) => React.createElement(Text, { key: j, style: [styles.cell, { flex: c.flex }] }, String(r[c.key] ?? "—")))))
    )
  );
}
