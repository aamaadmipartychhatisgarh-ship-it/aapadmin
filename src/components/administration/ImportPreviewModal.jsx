"use client";

import { useState } from "react";
import { X, CheckCircle2, AlertTriangle, AlertCircle, Download, Loader2 } from "lucide-react";

const SUMMARY_LABELS = {
  missing_name: "Missing name (skipped)",
  duplicate_mobile: "Duplicate mobile (skipped)",
  duplicate_membership: "Duplicate membership no (skipped)",
  invalid_district: "Invalid district",
  invalid_assembly: "Invalid assembly",
  invalid_block: "Invalid block",
  invalid_booth: "Invalid polling booth",
  missing_designation: "Missing designation",
};

function downloadCsv(rowErrors) {
  const header = ["Row", "Name", "Mobile", "Severity", "Reasons"];
  const lines = [header.join(",")];
  for (const e of rowErrors) {
    const cells = [e.row, e.name, e.mobile, e.severity, e.reasons.join("; ")].map((c) => {
      const s = String(c ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    });
    lines.push(cells.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `worker-import-errors-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Shows the dry-run validation result before anything is written, so the
// admin can see exactly what will happen — how many rows import cleanly, how
// many are skipped and why, how many import with a fixable warning — and
// download the full error list, before committing anything.
export default function ImportPreviewModal({ preview, onClose, onImported }) {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  async function confirmImport() {
    setImporting(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", preview.file);
      const r = await fetch("/api/workers/import-excel", { method: "POST", body: fd });
      const d = await r.json();
      if (r.ok) onImported(d);
      else setError(d.message || "Import failed");
    } catch {
      setError("Import failed — file too large or network error.");
    } finally {
      setImporting(false);
    }
  }

  const hasErrors = preview.error_count > 0;
  const hasWarnings = preview.warning_count > 0;
  const summaryEntries = Object.entries(preview.summary || {}).filter(([, n]) => n > 0);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Import Preview</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-5">
          {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">{error}</div>}

          <div className="grid grid-cols-4 gap-3">
            <Tile label="Total Rows" value={preview.total_rows} />
            <Tile label="Will Import" value={preview.valid_count} accent="text-emerald-600" />
            <Tile label="Skipped" value={preview.error_count} accent={hasErrors ? "text-red-600" : "text-gray-400"} />
            <Tile label="Warnings" value={preview.warning_count} accent={hasWarnings ? "text-amber-600" : "text-gray-400"} />
          </div>

          {summaryEntries.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Breakdown</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                {summaryEntries.map(([key, n]) => (
                  <div key={key} className="flex justify-between text-gray-600">
                    <span>{SUMMARY_LABELS[key] || key}</span>
                    <span className="font-semibold text-gray-900">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {preview.row_errors?.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Row Issues ({preview.row_errors.length})
                </h3>
                <button onClick={() => downloadCsv(preview.row_errors)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#164FA3] hover:underline">
                  <Download size={13} /> Download Error Report
                </button>
              </div>
              <div className="border border-gray-200 rounded-lg max-h-56 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Row</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Name</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.row_errors.slice(0, 200).map((e, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-2 py-1.5 text-gray-500">{e.row}</td>
                        <td className="px-2 py-1.5 text-gray-700">{e.name || "—"}</td>
                        <td className="px-2 py-1.5">
                          <span className={`inline-flex items-center gap-1 ${e.severity === "error" ? "text-red-600" : "text-amber-600"}`}>
                            {e.severity === "error" ? <AlertCircle size={12} /> : <AlertTriangle size={12} />}
                            {e.reasons.join("; ")}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.row_errors.length > 200 && (
                  <div className="px-2 py-1.5 text-center text-gray-400 text-xs border-t border-gray-100">
                    +{preview.row_errors.length - 200} more — see the full error report
                  </div>
                )}
              </div>
            </div>
          )}

          {preview.valid_count === 0 && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm flex items-center gap-2">
              <AlertTriangle size={16} /> No rows can be imported from this file — download the error report to see why.
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button
            onClick={confirmImport}
            disabled={importing || preview.valid_count === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold"
          >
            {importing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {importing ? "Importing…" : `Import ${preview.valid_count} row${preview.valid_count === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, accent = "text-gray-900" }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">{label}</div>
      <div className={`text-xl font-bold ${accent}`}>{(value ?? 0).toLocaleString()}</div>
    </div>
  );
}
