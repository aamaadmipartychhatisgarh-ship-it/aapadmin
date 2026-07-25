import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, scopeFilterSync } from "@/lib/permissions";
import { query } from "@/lib/db";
import { hasWrongNumberColumn } from "@/lib/contactExtras";
import * as XLSX from "xlsx";
import { renderToBuffer, Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import React from "react";

// GET /api/admin/wrong-numbers/export/xlsx|pdf — Supervisor/Admin only.
export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }
    const { format } = await params;
    if (format !== "xlsx" && format !== "pdf") {
      return NextResponse.json({ message: "Unsupported format" }, { status: 404 });
    }
    if (!(await hasWrongNumberColumn())) {
      return NextResponse.json({ message: "Wrong Number feature not enabled." }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const where = ["c.is_wrong_number = 1"];
    const qp = [];
    const eq = (key, col) => { const v = searchParams.get(key); if (v) { where.push(`c.${col} = ?`); qp.push(v); } };
    const search = searchParams.get("search");
    if (search) { where.push("(c.person_name LIKE ? OR c.phone_number LIKE ?)"); qp.push(`%${search}%`, `%${search}%`); }
    eq("zone_id", "zone_id"); eq("lok_sabha_id", "lok_sabha_id"); eq("district_id", "district_id");
    eq("assembly_id", "assembly_id"); eq("caller", "assigned_to_user_id");
    const statusF = searchParams.get("status");
    if (statusF === "assigned") where.push("c.assigned_to_user_id IS NOT NULL");
    if (statusF === "unassigned") where.push("c.assigned_to_user_id IS NULL");
    const scope = scopeFilterSync(session.user, "c");
    if (scope.where) { where.push(scope.where.replace(/^AND /, "")); qp.push(...scope.params); }

    const rows = await query(
      `SELECT c.person_name, c.phone_number, c.address,
              u.username AS caller_name,
              lz.name AS zone_name, lls.name AS lok_sabha_name, ld.name AS district_name,
              la.name AS assembly_name, lw.name AS ward_name,
              (SELECT COUNT(*) FROM calls x WHERE x.contact_id = c.id) AS attempts,
              (SELECT MAX(x.called_at) FROM calls x WHERE x.contact_id = c.id) AS last_call_date,
              (SELECT MAX(x.called_at) FROM calls x JOIN call_statuses cs ON cs.id = x.status_id
                 WHERE x.contact_id = c.id AND cs.name = 'Wrong Number') AS marked_wrong_date,
              (SELECT x.remarks FROM calls x WHERE x.contact_id = c.id ORDER BY x.called_at DESC, x.id DESC LIMIT 1) AS last_remarks
         FROM contacts c
         LEFT JOIN users u ON u.id = c.assigned_to_user_id
         LEFT JOIN locations lz ON lz.id = c.zone_id
         LEFT JOIN locations lls ON lls.id = c.lok_sabha_id
         LEFT JOIN locations ld ON ld.id = c.district_id
         LEFT JOIN locations la ON la.id = c.assembly_id
         LEFT JOIN locations lw ON lw.id = c.ward_id
        WHERE ${where.join(" AND ")}
        ORDER BY marked_wrong_date DESC, c.id DESC
        LIMIT 50000`,
      qp
    );

    const fmtDate = (d) => d ? new Date(d).toLocaleString("en-GB") : "";
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === "xlsx") {
      const data = rows.map((r) => ({
        Name: r.person_name || "", Mobile: r.phone_number || "",
        Zone: r.zone_name || "", "Lok Sabha": r.lok_sabha_name || "", District: r.district_name || "",
        Assembly: r.assembly_name || "", "Block/Ward": r.ward_name || "", Address: r.address || "",
        "Assigned Caller": r.caller_name || "Unassigned",
        "Marked Wrong On": fmtDate(r.marked_wrong_date), "Last Call": fmtDate(r.last_call_date),
        Attempts: r.attempts ?? 0, Status: "Wrong Number", Remarks: r.last_remarks || "",
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Wrong Numbers");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      return new Response(buf, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="wrong-numbers-${stamp}.xlsx"`,
        },
      });
    }

    const buffer = await renderToBuffer(
      React.createElement(Doc, { rows, fmtDate, subtitle: `${rows.length} records · ${new Date().toLocaleString("en-GB")}` })
    );
    return new Response(buffer, {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="wrong-numbers-${stamp}.pdf"` },
    });
  } catch (err) {
    console.error("wrong-numbers export error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 8, fontFamily: "Helvetica" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  subtitle: { fontSize: 9, color: "#555", marginBottom: 12 },
  row: { flexDirection: "row", borderBottom: 1, borderColor: "#eee", paddingVertical: 3 },
  headerRow: { backgroundColor: "#0B3A82", paddingVertical: 5 },
  cell: { paddingHorizontal: 3 },
  cellHeader: { paddingHorizontal: 3, color: "#fff", fontFamily: "Helvetica-Bold" },
});
const COLS = [
  { key: "person_name", label: "Name", flex: 2 },
  { key: "phone_number", label: "Mobile", flex: 1.5 },
  { key: "district_name", label: "District", flex: 1.5 },
  { key: "assembly_name", label: "Assembly", flex: 1.5 },
  { key: "ward_name", label: "Block", flex: 1.5 },
  { key: "caller_name", label: "Caller", flex: 1.5 },
  { key: "attempts", label: "Att.", flex: 0.6 },
];
function Doc({ rows, subtitle }) {
  return React.createElement(Document, null,
    React.createElement(Page, { size: "A4", orientation: "landscape", style: styles.page },
      React.createElement(Text, { style: styles.title }, "Wrong Numbers"),
      React.createElement(Text, { style: styles.subtitle }, subtitle),
      React.createElement(View, { style: [styles.row, styles.headerRow] },
        COLS.map((c, i) => React.createElement(Text, { key: i, style: [styles.cellHeader, { flex: c.flex }] }, c.label))),
      rows.map((r, i) => React.createElement(View, { key: i, style: styles.row, wrap: false },
        COLS.map((c, j) => React.createElement(Text, { key: j, style: [styles.cell, { flex: c.flex }] }, String(r[c.key] ?? "—")))))
    )
  );
}
