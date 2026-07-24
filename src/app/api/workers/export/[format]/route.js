import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSuperAdmin, scopeFilterSync } from "@/lib/permissions";
import { query } from "@/lib/db";
import * as XLSX from "xlsx";
import { renderToBuffer, Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import React from "react";

// GET /api/workers/export/xlsx  or  /api/workers/export/pdf
// Super Admin only. Honors the same filters the Workers list uses so the export
// matches what's on screen.
export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSuperAdmin(session)) {
      return NextResponse.json({ message: "Only Super Admin can export workers." }, { status: 403 });
    }
    const { format } = await params;
    if (format !== "xlsx" && format !== "pdf") {
      return NextResponse.json({ message: "Unsupported format" }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search");
    const zoneId = searchParams.get("zone_id");
    const lokSabhaId = searchParams.get("lok_sabha_id");
    const districtId = searchParams.get("district_id");
    const assemblyId = searchParams.get("assembly_id");
    const status = searchParams.get("status");
    const position = searchParams.get("position");

    const where = [];
    const qp = [];
    if (search) { where.push("(w.name LIKE ? OR w.mobile LIKE ?)"); qp.push(`%${search}%`, `%${search}%`); }
    if (zoneId) {
      where.push(`(
        w.zone_id = ?
        OR w.lok_sabha_id IN (SELECT id FROM locations WHERE type='lok_sabha' AND parent_id = ?)
        OR w.district_id IN (
          SELECT d.id FROM locations d JOIN locations ls ON ls.id = d.parent_id AND ls.type='lok_sabha' WHERE ls.parent_id = ?
        )
        OR w.assembly_id IN (
          SELECT a.id FROM locations a JOIN locations d ON d.id = a.parent_id AND d.type='district'
          JOIN locations ls ON ls.id = d.parent_id AND ls.type='lok_sabha' WHERE ls.parent_id = ?
        )
      )`);
      qp.push(zoneId, zoneId, zoneId, zoneId);
    }
    if (lokSabhaId) {
      where.push(`(
        w.lok_sabha_id = ?
        OR w.district_id IN (SELECT id FROM locations WHERE type='district' AND parent_id = ?)
        OR w.assembly_id IN (SELECT a.id FROM locations a JOIN locations d ON d.id = a.parent_id AND d.type='district' WHERE d.parent_id = ?)
      )`);
      qp.push(lokSabhaId, lokSabhaId, lokSabhaId);
    }
    if (districtId) { where.push("w.district_id = ?"); qp.push(districtId); }
    if (assemblyId) { where.push("w.assembly_id = ?"); qp.push(assemblyId); }
    if (status) { where.push("w.status = ?"); qp.push(status); }
    if (position) { where.push("(w.position = ? OR FIND_IN_SET(?, REPLACE(w.position, ', ', ',')))"); qp.push(position, position); }
    const scope = scopeFilterSync(session.user, "w"); // super_admin → no filter
    if (scope.where) { where.push(scope.where.replace(/^AND /, "")); qp.push(...scope.params); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query(
      `SELECT w.name, w.mobile, w.position, w.skills, w.activity_score, w.status,
              lz.name AS zone_name, lls.name AS lok_sabha_name, ld.name AS district_name,
              la.name AS assembly_name, lw.name AS ward_name, w.address
         FROM workers w
         LEFT JOIN locations ld ON ld.id = w.district_id
         LEFT JOIN locations la ON la.id = w.assembly_id
         LEFT JOIN locations lz ON lz.id = w.zone_id
         LEFT JOIN locations lls ON lls.id = w.lok_sabha_id
         LEFT JOIN locations lw ON lw.id = w.ward_id
         ${whereSql}
         ORDER BY w.activity_score DESC, w.id DESC
         LIMIT 50000`,
      qp
    );

    const stamp = new Date().toISOString().slice(0, 10);

    if (format === "xlsx") {
      const data = rows.map((r) => ({
        Name: r.name || "",
        Mobile: r.mobile || "",
        Designation: r.position || "",
        Zone: r.zone_name || "",
        "Lok Sabha": r.lok_sabha_name || "",
        District: r.district_name || "",
        Assembly: r.assembly_name || "",
        Ward: r.ward_name || "",
        Skills: r.skills || "",
        Activity: r.activity_score ?? 0,
        Status: r.status || "",
        Address: r.address || "",
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Workers");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      return new Response(buf, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="workers-${stamp}.xlsx"`,
        },
      });
    }

    // PDF
    const buffer = await renderToBuffer(
      React.createElement(WorkersDoc, { rows, subtitle: `${rows.length} workers · ${new Date().toLocaleString("en-GB")}` })
    );
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="workers-${stamp}.pdf"`,
      },
    });
  } catch (err) {
    console.error("workers export error:", err);
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
  { key: "name", label: "Name", flex: 2 },
  { key: "mobile", label: "Mobile", flex: 1.5 },
  { key: "position", label: "Designation", flex: 2 },
  { key: "district_name", label: "District", flex: 1.5 },
  { key: "assembly_name", label: "Assembly", flex: 1.5 },
  { key: "status", label: "Status", flex: 1 },
];

function WorkersDoc({ rows, subtitle }) {
  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", orientation: "landscape", style: styles.page },
      React.createElement(Text, { style: styles.title }, "Workers Directory"),
      React.createElement(Text, { style: styles.subtitle }, subtitle),
      React.createElement(
        View,
        { style: [styles.row, styles.headerRow] },
        COLS.map((c, i) => React.createElement(Text, { key: i, style: [styles.cellHeader, { flex: c.flex }] }, c.label))
      ),
      rows.map((r, i) =>
        React.createElement(
          View,
          { key: i, style: styles.row, wrap: false },
          COLS.map((c, j) => React.createElement(Text, { key: j, style: [styles.cell, { flex: c.flex }] }, String(r[c.key] ?? "—")))
        )
      )
    )
  );
}
