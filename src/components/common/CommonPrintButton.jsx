"use client";

import { useState } from "react";
import { Printer } from "lucide-react";

// Reusable native-print button. Every listed page drops this in; the shared
// `@media print` CSS (globals.css) hides the sidebar, top bar and all controls
// (anything marked `.no-print`), so the browser prints just the page content —
// charts and maps included, exactly as rendered. No per-page print code.
//
// Optional `beforePrint`/`afterPrint` let a page expand collapsed content or drop
// virtualized paging so everything is on the page before the print dialog opens.
export default function CommonPrintButton({
  label = "Print",
  className = "",
  beforePrint,
  afterPrint,
  title,
}) {
  const [busy, setBusy] = useState(false);

  async function handlePrint() {
    if (busy) return;
    setBusy(true);
    const prevTitle = document.title;
    try {
      if (title) document.title = title; // browsers use document.title as the PDF/file name
      if (beforePrint) await beforePrint();
      // Let the DOM settle (expanded rows, re-renders) before the print dialog.
      await new Promise((r) => setTimeout(r, 60));
      window.print();
    } finally {
      if (title) document.title = prevTitle;
      if (afterPrint) {
        try { await afterPrint(); } catch { /* noop */ }
      }
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handlePrint}
      disabled={busy}
      className={
        className ||
        "no-print flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
      }
      title="Print this page"
    >
      <Printer size={15} /> {label}
    </button>
  );
}
