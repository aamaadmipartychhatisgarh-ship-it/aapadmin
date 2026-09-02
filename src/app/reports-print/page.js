"use client";

import { useEffect, useState } from "react";
import { Loader2, Printer, RectangleHorizontal, RectangleVertical } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/dateFormat";

const PAYLOAD_KEY = "reports_print_payload";

// Dedicated print view — opened in a new tab from the Reports Center's Print
// button. Lives OUTSIDE src/app/dashboard/** on purpose: any route nested
// under there inherits dashboard/layout.js's sidebar+header shell, which is
// exactly the "UI elements" a printable report must not carry. This route
// only shares the minimal root layout (fonts/providers), not the dashboard
// chrome. The filter config is handed off via sessionStorage (set by the
// Reports Center just before opening this tab) — URL query strings can't
// reliably carry a multi-select filter set this size.
export default function ReportPrintPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [orientation, setOrientation] = useState("landscape");

  useEffect(() => {
    let payload;
    try { payload = JSON.parse(sessionStorage.getItem(PAYLOAD_KEY) || "null"); } catch { payload = null; }
    if (!payload) { setErr("No report loaded — open Print again from the Reports Center."); return; }
    setOrientation(payload.orientation === "portrait" ? "portrait" : "landscape");
    fetch("/api/reports/export?format=json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload.body),
    })
      .then(async (r) => { if (!r.ok) throw new Error((await r.json()).message || "Failed to load report"); return r.json(); })
      .then(setData)
      .catch((e) => setErr(e.message));
  }, []);

  return (
    <div style={{ fontFamily: "Arial, sans-serif", color: "#1a1a1a" }}>
      <style>{`
        @page { size: A4 ${orientation}; margin: 14mm; }
        @media print { .no-print { display: none !important; } body { margin: 0; } }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 5px 8px; font-size: 10px; text-align: left; }
        th { background: #0B3A82; color: #fff; }
        tr:nth-child(even) td { background: #F7F9FC; }
      `}</style>

      <div className="no-print" style={{ display: "flex", gap: 8, padding: 12, background: "#F4F6FA", borderBottom: "1px solid #ddd", position: "sticky", top: 0 }}>
        <button
          onClick={() => setOrientation("portrait")}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: "1px solid #ccc", background: orientation === "portrait" ? "#164FA3" : "#fff", color: orientation === "portrait" ? "#fff" : "#333", fontSize: 13, cursor: "pointer" }}
        ><RectangleVertical size={14} /> Portrait</button>
        <button
          onClick={() => setOrientation("landscape")}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: "1px solid #ccc", background: orientation === "landscape" ? "#164FA3" : "#fff", color: orientation === "landscape" ? "#fff" : "#333", fontSize: 13, cursor: "pointer" }}
        ><RectangleHorizontal size={14} /> Landscape</button>
        <button
          onClick={() => window.print()}
          disabled={!data}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, border: "none", background: "#164FA3", color: "#fff", fontSize: 13, cursor: data ? "pointer" : "not-allowed", opacity: data ? 1 : 0.5, marginLeft: "auto" }}
        ><Printer size={14} /> Print</button>
      </div>

      <div style={{ padding: "20px 24px" }}>
        {err && <div style={{ color: "#b91c1c", padding: 20 }}>{err}</div>}
        {!err && !data && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 40, color: "#888" }}><Loader2 className="animate-spin" size={18} /> Preparing report…</div>}
        {data && <ReportPrintout data={data} />}
      </div>
    </div>
  );
}

function ReportPrintout({ data }) {
  const { title, filterLines, generatedBy, generatedAt, result } = data;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, borderBottom: "3px solid #164FA3", paddingBottom: 10, marginBottom: 10 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/kejriwal-header.jpg" alt="Arvind Kejriwal" style={{ width: 44, height: 44, borderRadius: 22, objectFit: "cover" }} />
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#164FA3" }}>Aam Aadmi Party Chhattisgarh</div>
          <div style={{ fontSize: 11, color: "#666" }}>Honest Politics | Better Chhattisgarh</div>
        </div>
      </div>

      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "8px 0 4px" }}>{title} Report</h1>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#555", marginBottom: 10 }}>
        <span>Generated: {formatDateTime(generatedAt)}</span>
        <span>Generated by: {generatedBy}</span>
      </div>

      {filterLines?.length > 0 && (
        <div style={{ background: "#F4F6FA", borderRadius: 6, padding: "8px 12px", marginBottom: 14 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: "#164FA3", textTransform: "uppercase", marginBottom: 3 }}>Filters applied</div>
          {filterLines.map((line, i) => <div key={i} style={{ fontSize: 11, color: "#333" }}>{line}</div>)}
        </div>
      )}

      {result.mode === "summary" ? <SummaryTable result={result} /> : <DetailTable result={result} />}

      <div className="no-print" style={{ marginTop: 16, fontSize: 11, color: "#999" }}>
        Page numbers aren't reliable in browser print — use the PDF export from Reports Center for a numbered document.
      </div>
    </div>
  );
}

function SummaryTable({ result }) {
  const total = result.rows.reduce((s, r) => s + r.count, 0);
  return (
    <table>
      <thead><tr><th>{result.group_label}</th><th style={{ textAlign: "right" }}>Count</th></tr></thead>
      <tbody>
        {result.rows.map((r, i) => (
          <tr key={i}><td>{r.group_key ?? "—"}</td><td style={{ textAlign: "right" }}>{r.count}</td></tr>
        ))}
      </tbody>
      <tfoot>
        <tr style={{ fontWeight: 700, background: "#EEF2FA" }}>
          <td>Total — {result.rows.length} groups</td>
          <td style={{ textAlign: "right" }}>{total}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function DetailTable({ result }) {
  const fmt = (col, v) => {
    if (v === null || v === undefined || v === "") return "—";
    if (col.type === "bool") return v == 1 ? "Yes" : "No";
    if (col.type === "datetime") return formatDateTime(v);
    if (col.type === "date") return formatDate(v);
    return String(v);
  };
  return (
    <>
      <table>
        <thead><tr>{result.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i}>{result.columns.map((c) => <td key={c.key}>{fmt(c, row[c.key])}</td>)}</tr>
          ))}
          {result.rows.length === 0 && <tr><td colSpan={result.columns.length} style={{ textAlign: "center", color: "#999" }}>No records match these filters.</td></tr>}
        </tbody>
      </table>
      <div style={{ marginTop: 8, fontWeight: 700, fontSize: 11, color: "#0B3A82" }}>
        Total records: {result.total}{result.truncated ? ` (showing first ${result.rows.length} — refine filters to narrow further)` : ""}
      </div>
    </>
  );
}
