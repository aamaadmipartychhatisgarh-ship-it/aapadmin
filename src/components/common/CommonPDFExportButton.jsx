"use client";

import { useState } from "react";
import { Download, Loader2, FileText } from "lucide-react";

// Reusable "Export PDF" button shared by every listed page. The page supplies a
// `getPayload()` that returns what it is CURRENTLY showing (already filtered):
//
//   <CommonPDFExportButton
//     filename="tasks.pdf"
//     getPayload={() => ({
//       title: "Tasks",
//       subtitle: `${rows.length} tasks · filter: ${status}`,
//       orientation: "landscape",
//       table: { columns: [{header:"Title",flex:2}, ...], rows: rows.map(r => [r.title, ...]) },
//       // and/or images: [{ src: dataUri, caption }]  for charts/maps
//     })}
//   />
//
// It POSTs that to the single shared /api/pdf/generate route (common header, page
// numbers, repeating table headers) and downloads the result. Built-in: a loading
// spinner, a duplicate-click guard (ignores clicks while working), and inline
// error text. No per-page PDF code and no separate export endpoints.
export default function CommonPDFExportButton({
  getPayload,
  filename = "export.pdf",
  label = "Export PDF",
  className = "",
  icon = "download",
  onError,
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function handleExport() {
    if (busy) return; // prevent duplicate concurrent exports
    setBusy(true);
    setErr("");
    try {
      const payload = (await (typeof getPayload === "function" ? getPayload() : getPayload)) || {};
      const body = { filename, ...payload };
      const res = await fetch("/api/pdf/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let msg = "Export failed";
        try { msg = (await res.json()).message || msg; } catch { /* non-JSON */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = body.filename || filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      const msg = e?.message || "Export failed";
      setErr(msg);
      if (onError) onError(msg);
      // Auto-clear the inline error so it doesn't linger.
      setTimeout(() => setErr(""), 5000);
    } finally {
      setBusy(false);
    }
  }

  const Icon = icon === "file" ? FileText : Download;
  return (
    <span className="no-print inline-flex flex-col items-start">
      <button
        type="button"
        onClick={handleExport}
        disabled={busy}
        className={
          className ||
          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-[#164FA3] text-[#164FA3] hover:bg-blue-50 disabled:opacity-40"
        }
        title="Export this page as PDF"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} />}
        {busy ? "Preparing…" : label}
      </button>
      {err ? <span className="mt-1 text-[11px] text-red-600 max-w-[220px]">{err}</span> : null}
    </span>
  );
}
