"use client";

import { useState } from "react";
import { Download, Loader2, FileText, Share2 } from "lucide-react";
import { shareGenerated } from "@/components/pdfShare/fileShare";

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
  fetchUrl,
  filename = "export.pdf",
  label = "Export PDF",
  className = "",
  icon = "download",
  onError,
  // Share (common file sharing): a "Share" button beside Export — it builds the SAME PDF and opens the share panel / native
  // share sheet without downloading. Every Print button in the app sits beside this button, so Print always has Share too.
  share = true,
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // The PDF, exactly as Export downloads it (one code path for Export and Share).
  async function generate() {
      const payload = fetchUrl ? {} : (await (typeof getPayload === "function" ? getPayload() : getPayload)) || {};
      const body = { filename, ...payload };
      const res = fetchUrl
        ? await fetch(typeof fetchUrl === "function" ? fetchUrl() : fetchUrl, { cache: "no-store" })
        : await fetch("/api/pdf/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      if (!res.ok) {
        let msg = "Export failed";
        try { msg = (await res.json()).message || msg; } catch { /* non-JSON */ }
        throw new Error(msg);
      }
      return { blob: await res.blob(), filename: body.filename || filename };
  }

  async function handleShare() {
    if (busy) return;
    await shareGenerated(generate, { label: "PDF" });
  }

  async function handleExport() {
    if (busy) return; // prevent duplicate concurrent exports
    setBusy(true);
    setErr("");
    try {
      // `fetchUrl` (optional): the server builds the PDF itself from the page's current
      // filters (GET) — used where the content must come straight from the database
      // (e.g. long complaint descriptions) rather than from rows posted by the browser.
      const { blob, filename: name } = await generate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
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
      <span className="inline-flex items-center gap-2">
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
      {share && (
        <button type="button" onClick={handleShare} disabled={busy} data-testid="common-share"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          title="Share this page as a PDF (WhatsApp, Email, …)">
          <Share2 size={15} /> Share
        </button>
      )}
      </span>
      {err ? <span className="mt-1 text-[11px] text-red-600 max-w-[220px]">{err}</span> : null}
    </span>
  );
}
