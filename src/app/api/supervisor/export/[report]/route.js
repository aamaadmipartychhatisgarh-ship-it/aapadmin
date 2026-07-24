import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { query } from "@/lib/db";
import { renderToBuffer, Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import React from "react";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: "Helvetica" },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#555", marginBottom: 16 },
  table: { display: "flex", flexDirection: "column", borderTop: 1, borderColor: "#ddd" },
  row: { flexDirection: "row", borderBottom: 1, borderColor: "#eee", paddingVertical: 4 },
  headerRow: { backgroundColor: "#0B3A82", color: "#fff", paddingVertical: 6, paddingHorizontal: 4 },
  cell: { paddingHorizontal: 4 },
  cellHeader: { paddingHorizontal: 4, fontFamily: "Helvetica-Bold" },
});

function Table({ columns, rows }) {
  return React.createElement(
    View,
    { style: styles.table },
    React.createElement(
      View,
      { style: [styles.row, styles.headerRow] },
      columns.map((c, i) =>
        React.createElement(Text, { key: i, style: [styles.cellHeader, { width: c.width || "auto", flex: c.flex || 1, color: "#fff" }] }, c.label)
      )
    ),
    rows.map((r, i) =>
      React.createElement(
        View,
        { key: i, style: styles.row },
        columns.map((c, j) =>
          React.createElement(Text, { key: j, style: [styles.cell, { width: c.width || "auto", flex: c.flex || 1 }] }, String(r[c.key] ?? "—"))
        )
      )
    )
  );
}

function ReportDocument({ title, subtitle, columns, rows }) {
  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", style: styles.page },
      React.createElement(Text, { style: styles.title }, title),
      React.createElement(Text, { style: styles.subtitle }, subtitle),
      React.createElement(Table, { columns, rows })
    )
  );
}

async function buildCallersReport({ date_from, date_to } = {}) {
  // Date filter goes on the LEFT JOIN's ON clause so zero-call users still show.
  const params = [];
  let joinExtra = "";
  if (date_from) { joinExtra += " AND DATE(c.called_at) >= ?"; params.push(date_from); }
  if (date_to)   { joinExtra += " AND DATE(c.called_at) <= ?"; params.push(date_to); }
  const rows = await query(
    `SELECT u.username AS name,
            COUNT(c.id) AS total_calls,
            SUM(CASE WHEN cs.name = 'Phone Picked' THEN 1 ELSE 0 END) AS connected,
            SUM(CASE WHEN c.is_follow_up_required = 1 THEN 1 ELSE 0 END) AS follow_ups,
            ROUND(AVG(c.duration_seconds), 0) AS avg_dur
       FROM users u
       LEFT JOIN calls c ON c.user_id = u.id ${joinExtra}
       LEFT JOIN call_statuses cs ON cs.id = c.status_id
      WHERE u.role IN ('caller','user','agent')
      GROUP BY u.id, u.username
      ORDER BY total_calls DESC`,
    params
  );
  const range = date_from || date_to ? `  |  ${date_from || "…"} → ${date_to || "…"}` : "  |  All time";
  return {
    title: "Caller-Wise Performance Report",
    subtitle: new Date().toLocaleString("en-GB") + range,
    columns: [
      { key: "name", label: "Caller", flex: 2 },
      { key: "total_calls", label: "Total", flex: 1 },
      { key: "connected", label: "Connected", flex: 1 },
      { key: "follow_ups", label: "Follow-ups", flex: 1 },
      { key: "avg_dur", label: "Avg dur (s)", flex: 1 },
    ],
    rows,
  };
}

async function buildAreasReport() {
  const rows = await query(
    `SELECT l.name AS area_name,
            COUNT(c.id) AS total_calls,
            SUM(CASE WHEN cs.name = 'Phone Picked' THEN 1 ELSE 0 END) AS connected,
            SUM(CASE WHEN c.sentiment IN ('positive','supporter') THEN 1 ELSE 0 END) AS positive,
            SUM(CASE WHEN c.sentiment IN ('negative','opponent') THEN 1 ELSE 0 END) AS negative
       FROM locations l
       LEFT JOIN calls c ON c.district_id = l.id
       LEFT JOIN call_statuses cs ON cs.id = c.status_id
      WHERE l.type = 'district'
      GROUP BY l.id, l.name
      ORDER BY total_calls DESC`
  );
  return {
    title: "District-Wise Calling Report",
    subtitle: new Date().toLocaleString("en-GB"),
    columns: [
      { key: "area_name", label: "District", flex: 2 },
      { key: "total_calls", label: "Total", flex: 1 },
      { key: "connected", label: "Connected", flex: 1 },
      { key: "positive", label: "Positive", flex: 1 },
      { key: "negative", label: "Negative", flex: 1 },
    ],
    rows,
  };
}

async function buildSummaryReport() {
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM calls WHERE DATE(called_at) = CURDATE()`);
  const buckets = await query(
    `SELECT cs.name AS status_name, COUNT(c.id) AS count
       FROM calls c
       LEFT JOIN call_statuses cs ON cs.id = c.status_id
      WHERE DATE(c.called_at) = CURDATE()
      GROUP BY cs.name`
  );
  return {
    title: "Daily Calling Summary",
    subtitle: `${new Date().toLocaleDateString("en-GB")} — Total: ${total} calls`,
    columns: [
      { key: "status_name", label: "Status", flex: 2 },
      { key: "count", label: "Count", flex: 1 },
    ],
    rows: buckets,
  };
}

const REPORTS = {
  callers: buildCallersReport,
  areas: buildAreasReport,
  summary: buildSummaryReport,
};

export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisor(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { report } = await params;
    const builder = REPORTS[report];
    if (!builder) {
      return NextResponse.json({ message: "Unknown report" }, { status: 404 });
    }
    const { searchParams } = new URL(req.url);
    const payload = await builder({
      date_from: searchParams.get("date_from"),
      date_to: searchParams.get("date_to"),
    });
    const buffer = await renderToBuffer(React.createElement(ReportDocument, payload));
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${report}-${new Date().toISOString().slice(0, 10)}.pdf"`,
      },
    });
  } catch (err) {
    console.error("supervisor/export error:", err);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
