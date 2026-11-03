"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";

// The "MA" button (Admin Panel): Show/Hide Amount & Expenses everywhere (page, sidebar, Dashboard card, APIs).
export default function MaSwitch({ enabled, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function toggle() {
    if (busy || enabled == null) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/ma", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !enabled }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.message || "Could not change the setting.");
      onChanged?.(!!d.enabled);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={toggle} disabled={busy || enabled == null} data-testid="ma-button" aria-pressed={!!enabled}
        title={enabled ? "Amount & Expenses is SHOWN - click to hide" : "Amount & Expenses is HIDDEN - click to show"}
        className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-sm font-bold transition-colors ${enabled ? "bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700" : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
        {busy && <Loader2 size={14} className="animate-spin" />}MA
        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-90" data-testid="ma-state">{enabled == null ? "…" : enabled ? "On" : "Off"}</span>
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  );
}
