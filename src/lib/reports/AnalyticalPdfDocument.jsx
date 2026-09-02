import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import React from "react";
import { PdfHeader, PDF_HEADER_HEIGHT } from "@/lib/pdf/commonHeader";

// Rich analytical report: KPI cards, a per-day bar chart, and breakdown tables
// (by status / assembly / caller / designation …) with share % and inline bars.
// Built from the payload produced by src/lib/reports/analytical.js.

const BLUE = "#164FA3";
const s = StyleSheet.create({
  page: { paddingTop: PDF_HEADER_HEIGHT + 12, paddingBottom: 42, paddingHorizontal: 28, fontSize: 9, fontFamily: "Helvetica", color: "#1f2937" },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 8, paddingBottom: 8, borderBottom: 2, borderColor: BLUE },
  logo: { width: 34, height: 34, borderRadius: 17, marginRight: 10 },
  orgName: { fontSize: 13, fontFamily: "Helvetica-Bold", color: "#0B3A82" },
  orgSub: { fontSize: 7.5, color: "#666" },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 2, color: "#111827" },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  meta: { fontSize: 8, color: "#666" },
  filtersBox: { backgroundColor: "#f3f6fb", borderRadius: 4, padding: 6, marginBottom: 10 },
  filterLine: { fontSize: 7.5, color: "#374151", marginBottom: 1 },

  kpiRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  kpiCard: { flex: 1, backgroundColor: "#f8fafc", borderRadius: 6, borderLeft: 3, borderColor: BLUE, padding: 8 },
  kpiValue: { fontSize: 16, fontFamily: "Helvetica-Bold", color: "#0B3A82" },
  kpiLabel: { fontSize: 7.5, color: "#6b7280", marginTop: 2 },

  sectionTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", color: "#0B3A82", marginTop: 6, marginBottom: 4 },

  chartWrap: { marginBottom: 12 },
  chartArea: { flexDirection: "row", alignItems: "flex-end", height: 90, gap: 2, borderBottom: 1, borderColor: "#d1d5db", paddingBottom: 0 },
  bar: { flex: 1, backgroundColor: BLUE, borderTopLeftRadius: 1, borderTopRightRadius: 1 },
  chartLabels: { flexDirection: "row", gap: 2, marginTop: 2 },
  chartLabel: { flex: 1, fontSize: 5.5, color: "#9ca3af", textAlign: "center" },

  tableRow: { flexDirection: "row", alignItems: "center", paddingVertical: 2.5, borderBottom: 0.5, borderColor: "#eef2f7" },
  tHeadRow: { flexDirection: "row", backgroundColor: "#eef2f7", paddingVertical: 3, paddingHorizontal: 2, borderRadius: 2 },
  th: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#374151" },
  cName: { width: "40%", fontSize: 8, paddingRight: 4 },
  cBar: { width: "38%", paddingRight: 6, justifyContent: "center" },
  cBarTrack: { height: 6, backgroundColor: "#e5e7eb", borderRadius: 3 },
  cBarFill: { height: 6, backgroundColor: BLUE, borderRadius: 3 },
  cCount: { width: "12%", fontSize: 8, textAlign: "right", fontFamily: "Helvetica-Bold" },
  cPct: { width: "10%", fontSize: 7.5, textAlign: "right", color: "#6b7280" },

  footer: { position: "absolute", bottom: 16, left: 28, right: 28, flexDirection: "row", justifyContent: "space-between", borderTop: 1, borderColor: "#e5e7eb", paddingTop: 5 },
  footerText: { fontSize: 7, color: "#9ca3af" },
});

function fmtInt(n) { return Number(n || 0).toLocaleString("en-IN"); }

function BreakdownTable({ section }) {
  const rows = section.rows.slice(0, 15);
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <View wrap={false} style={{ marginBottom: 10 }}>
      <Text style={s.sectionTitle}>{section.groupLabel}</Text>
      <View style={s.tHeadRow}>
        <Text style={[s.th, s.cName]}>{section.groupLabel}</Text>
        <Text style={[s.th, s.cBar]}> </Text>
        <Text style={[s.th, s.cCount]}>Count</Text>
        <Text style={[s.th, s.cPct]}>Share</Text>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={s.tableRow}>
          <Text style={s.cName}>{String(r.group_key)}</Text>
          <View style={s.cBar}><View style={s.cBarTrack}><View style={[s.cBarFill, { width: `${Math.max(2, (r.count / max) * 100)}%` }]} /></View></View>
          <Text style={s.cCount}>{fmtInt(r.count)}</Text>
          <Text style={s.cPct}>{r.pct}%</Text>
        </View>
      ))}
      {section.rows.length > 15 && (
        <Text style={{ fontSize: 7, color: "#9ca3af", marginTop: 2 }}>+ {section.rows.length - 15} more…</Text>
      )}
    </View>
  );
}

export default function AnalyticalPdfDocument({ title, subtitle, filterLines = [], generatedBy, data }) {
  const { total = 0, sections = [], timeseries } = data || {};
  const assemblySection = sections.find((x) => x.key === "assembly");
  const topAssembly = assemblySection?.rows?.[0];
  const maxDay = timeseries ? Math.max(1, ...timeseries.map((d) => d.count)) : 1;

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Common fixed header (Kejriwal photo + party name), on every page. */}
        <PdfHeader subtitle={title} />

        <Text style={s.title}>{title} — Analytical Report</Text>
        <View style={s.metaRow}>
          <Text style={s.meta}>{subtitle || ""}</Text>
          <Text style={s.meta}>Generated: {new Date().toLocaleString("en-IN")}  ·  By: {generatedBy || "—"}</Text>
        </View>

        {filterLines.length > 0 && (
          <View style={s.filtersBox}>
            {filterLines.map((l, i) => <Text key={i} style={s.filterLine}>{l}</Text>)}
          </View>
        )}

        {/* KPI cards */}
        <View style={s.kpiRow}>
          <View style={s.kpiCard}>
            <Text style={s.kpiValue}>{fmtInt(total)}</Text>
            <Text style={s.kpiLabel}>Total Records</Text>
          </View>
          {assemblySection && (
            <View style={s.kpiCard}>
              <Text style={s.kpiValue}>{fmtInt(assemblySection.rows.length)}</Text>
              <Text style={s.kpiLabel}>Assemblies Covered</Text>
            </View>
          )}
          {topAssembly && (
            <View style={s.kpiCard}>
              <Text style={s.kpiValue}>{fmtInt(topAssembly.count)}</Text>
              <Text style={s.kpiLabel}>Top: {String(topAssembly.group_key)}</Text>
            </View>
          )}
          <View style={s.kpiCard}>
            <Text style={s.kpiValue}>{fmtInt(sections.length)}</Text>
            <Text style={s.kpiLabel}>Breakdown Dimensions</Text>
          </View>
        </View>

        {/* Time-series bar chart */}
        {timeseries && timeseries.length > 1 && (
          <View style={s.chartWrap}>
            <Text style={s.sectionTitle}>Records per Day</Text>
            <View style={s.chartArea}>
              {timeseries.map((d, i) => (
                <View key={i} style={[s.bar, { height: `${Math.max(2, (d.count / maxDay) * 100)}%` }]} />
              ))}
            </View>
            <View style={s.chartLabels}>
              {timeseries.map((d, i) => (
                <Text key={i} style={s.chartLabel}>{timeseries.length <= 16 || i % 3 === 0 ? d.day.slice(5) : ""}</Text>
              ))}
            </View>
          </View>
        )}

        {/* Breakdown tables */}
        {sections.map((sec) => <BreakdownTable key={sec.key} section={sec} />)}

        {sections.length === 0 && (
          <Text style={{ fontSize: 9, color: "#9ca3af", marginTop: 10 }}>No data for the selected filters.</Text>
        )}

        <View style={s.footer} fixed>
          <Text style={s.footerText}>Aam Aadmi Party, Chhattisgarh — Analytical Report</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
