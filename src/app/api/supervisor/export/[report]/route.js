import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { query } from "@/lib/db";
import { renderToBuffer, Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import React from "react";
import { PdfHeader, PDF_HEADER_HEIGHT } from "@/lib/pdf/commonHeader";
import { scopeFilterSync, loadUserScope, normalizeRole, ROLES } from "@/lib/permissions";

// Reports Audit Phase 1 (security fix): every builder below queried ALL
// users / ALL districts / the WHOLE day's calls with no territory
// restriction at all — only `isSupervisor(session)` gated the route, and
// that check passes for every oversight role down to assembly_admin. A
// scoped admin who cannot see another district anywhere else in the app
// could still pull a statewide PDF through this one endpoint. Every builder
// now takes the caller's own `user` (post-loadUserScope) and narrows to
// their territory, exactly like every Reports Engine module already does
// via scopeFilterSync — unrestricted roles (super_admin/state_admin/
// supervisor) are unaffected, matching scopeFilterSync's own definition of
// "sees everything by default".

/**
 * districtScopeWhere — the district-list report's rows ARE districts
 * (`locations l`), not rows that HAVE a district_id column, so
 * scopeFilterSync's generic `{alias}.{col} = ?` shape doesn't apply
 * directly. Same role branches, same subqueries scopeFilterSync uses
 * internally for zone_id/assembly_id -> district_id, just re-targeted at
 * the district row's own `id`.
 */
function districtScopeWhere(user) {
  const role = normalizeRole(user?.role);
  if (role === ROLES.SUPER_ADMIN || role === ROLES.STATE_ADMIN || role === ROLES.SUPERVISOR) {
    return { where: "", params: [] };
  }
  if (role === ROLES.ZONE_ADMIN) {
    if (!user.scope_zone_id) return { where: "AND 1 = 0", params: [] };
    return {
      where: `AND l.id IN (
        SELECT d.id FROM locations d
        JOIN locations ls ON ls.id = d.parent_id AND ls.type = 'lok_sabha'
        WHERE ls.parent_id = ?
      )`,
      params: [user.scope_zone_id],
    };
  }
  if (role === ROLES.DISTRICT_ADMIN || role === ROLES.CALLER || role === ROLES.WORKER) {
    if (!user.home_district_id) return { where: "AND 1 = 0", params: [] };
    return { where: "AND l.id = ?", params: [user.home_district_id] };
  }
  if (role === ROLES.ASSEMBLY_ADMIN) {
    if (!user.scope_assembly_id) return { where: "AND 1 = 0", params: [] };
    return { where: "AND l.id = (SELECT parent_id FROM locations WHERE id = ?)", params: [user.scope_assembly_id] };
  }
  return { where: "AND 1 = 0", params: [] };
}

const styles = StyleSheet.create({
  page: { paddingTop: PDF_HEADER_HEIGHT + 12, paddingBottom: 32, paddingHorizontal: 32, fontSize: 10, fontFamily: "Helvetica" },
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
      React.createElement(PdfHeader, { subtitle: title }),
      React.createElement(Text, { style: styles.title }, title),
      React.createElement(Text, { style: styles.subtitle }, subtitle),
      React.createElement(Table, { columns, rows })
    )
  );
}

async function buildCallersReport({ date_from, date_to, user } = {}) {
  // Date filter goes on the LEFT JOIN's ON clause so zero-call users still show.
  // Geo scope goes the same place, for the same reason: a WHERE-clause scope
  // would evaluate against a NULL district_id for a zero-call user (unmatched
  // LEFT JOIN) and incorrectly drop them from the report entirely.
  const params = [];
  let joinExtra = "";
  if (date_from) { joinExtra += " AND DATE(c.called_at) >= ?"; params.push(date_from); }
  if (date_to)   { joinExtra += " AND DATE(c.called_at) <= ?"; params.push(date_to); }
  const scope = scopeFilterSync(user, "c", { cols: ["zone_id", "district_id", "assembly_id"] });
  joinExtra += " " + scope.where;
  params.push(...scope.params);
  const rows = await query(
    `SELECT u.username AS name,
            COUNT(c.id) AS total_calls,
            SUM(CASE WHEN cs.name = 'Phone Picked' THEN 1 ELSE 0 END) AS connected,
            SUM(CASE WHEN c.is_follow_up_required = 1 THEN 1 ELSE 0 END) AS follow_ups,
            ROUND(AVG(GREATEST(COALESCE(c.duration_seconds, 0), 0)), 0) AS avg_dur
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

async function buildAreasReport({ user } = {}) {
  const scope = districtScopeWhere(user);
  const rows = await query(
    `SELECT l.name AS area_name,
            COUNT(c.id) AS total_calls,
            SUM(CASE WHEN cs.name = 'Phone Picked' THEN 1 ELSE 0 END) AS connected,
            SUM(CASE WHEN c.sentiment IN ('positive','supporter') THEN 1 ELSE 0 END) AS positive,
            SUM(CASE WHEN c.sentiment IN ('negative','opponent') THEN 1 ELSE 0 END) AS negative
       FROM locations l
       LEFT JOIN calls c ON c.district_id = l.id
       LEFT JOIN call_statuses cs ON cs.id = c.status_id
      WHERE l.type = 'district' ${scope.where}
      GROUP BY l.id, l.name
      ORDER BY total_calls DESC`,
    scope.params
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

async function buildSummaryReport({ user } = {}) {
  const scope = scopeFilterSync(user, "c", { cols: ["zone_id", "district_id", "assembly_id"] });
  // buildCallersReport/buildAreasReport alias calls as `c` too; this query has
  // no join to rename, so it aliases `calls` itself as `c` to match scope.where.
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM calls c WHERE DATE(c.called_at) = CURDATE() ${scope.where}`,
    scope.params
  );
  const buckets = await query(
    `SELECT cs.name AS status_name, COUNT(c.id) AS count
       FROM calls c
       LEFT JOIN call_statuses cs ON cs.id = c.status_id
      WHERE DATE(c.called_at) = CURDATE() ${scope.where}
      GROUP BY cs.name`,
    scope.params
  );
  return {
    title: "Daily Calling Summary",
    subtitle: `${new Date().toLocaleDateString("en-GB").replace(/\//g, "-")} — Total: ${total} calls`,
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
    // Load the scope columns (home_district_id/scope_zone_id/scope_assembly_id)
    // onto session.user before any builder runs — same call the Reports
    // Engine's own guard makes; scopeFilterSync/districtScopeWhere are no-ops
    // without it and every scoped role would silently fall through to
    // "AND 1 = 0" (an empty report) rather than their real territory.
    await loadUserScope(session, query);
    const { searchParams } = new URL(req.url);
    const payload = await builder({
      date_from: searchParams.get("date_from"),
      date_to: searchParams.get("date_to"),
      user: session.user,
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
