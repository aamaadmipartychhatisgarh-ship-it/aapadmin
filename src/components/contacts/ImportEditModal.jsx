"use client";

import { useRef, useState } from "react";
import { X, Upload, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2, Download } from "lucide-react";

// "Import Edit" — update EXISTING contacts from a spreadsheet. Kept separate from the
// normal Import (which only adds new contacts). Step 1 choose a file → step 2 preview
// (nothing is written yet: matched contacts, the exact changes, unmatched rows and
// errors) → step 3 confirm to apply → result (updated / failed).
const STATUS_META = {
  update: ["Will update", "bg-emerald-50 text-emerald-700 border-emerald-200"],
  updated: ["Updated", "bg-emerald-50 text-emerald-700 border-emerald-200"],
  no_change: ["No change", "bg-gray-50 text-gray-500 border-gray-200"],
  unmatched: ["Not found", "bg-amber-50 text-amber-700 border-amber-200"],
  out_of_scope: ["Outside your area", "bg-amber-50 text-amber-700 border-amber-200"],
  duplicate_identifier: ["Duplicate ID", "bg-red-50 text-red-700 border-red-200"],
  error: ["Error", "bg-red-50 text-red-700 border-red-200"],
  failed: ["Failed", "bg-red-50 text-red-700 border-red-200"],
};

function Tile({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
      <div className={`text-lg font-bold ${tone || "text-gray-900"}`}>{value}</div>
      <div className="text-[11px] text-gray-500">{label}</div>
    </div>
  );
}

export default function ImportEditModal({ onClose, onApplied }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState(null);     // preview or result payload
  const [error, setError] = useState("");
  const [show, setShow] = useState("all");
  const inputRef = useRef(null);

  async function send(dry) {
    if (!file || busy) return;
    setBusy(true); setError("");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/contacts/import-edit${dry ? "?dry_run=1" : ""}`, { method: "POST", body: fd, signal: controller.signal });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.message || "Import Edit failed. Check the file and try again."); if (dry) setData(null); return; }
      setData(d); setShow("all");
      if (!dry) onApplied?.();
    } catch (e) {
      setError(e?.name === "AbortError" ? "The request timed out. Try a smaller file." : "Network error — please try again.");
    } finally {
      clearTimeout(timeoutId); setBusy(false);
    }
  }

  const s = data?.summary;
  const isResult = data && data.dry_run === false;
  const rows = (data?.rows || []).filter((r) => show === "all" || (show === "problems" ? !["update", "updated", "no_change"].includes(r.status) : r.status === show));
  const problems = s ? s.unmatched + s.out_of_scope + s.duplicate_identifiers + s.errors + (s.failed || 0) : 0;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Import Edit — update existing contacts</h2>
          <button onClick={onClose} disabled={busy} className="text-gray-400 hover:text-gray-600 disabled:opacity-40" aria-label="Close"><X size={20} /></button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          {!data && (
            <>
              <p className="text-sm text-gray-500">
                Upload an Excel / CSV file with a <span className="font-medium text-gray-700">Contact ID</span> column (or a
                <span className="font-medium text-gray-700"> Phone</span> column) plus the columns to change — Name, Phone, Address,
                Pincode, Village, Remarks, Designation, District, Assembly. Only existing contacts are updated; no new contacts are created.
                A <span className="font-medium text-gray-700">blank cell leaves the field unchanged</span>; type <code className="bg-gray-100 px-1 rounded">[clear]</code> to deliberately empty Address, Pincode, Village or Remarks.
              </p>
              <button type="button" onClick={() => { window.location.href = "/api/contacts/import-edit/template"; }} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#164FA3] hover:underline"><Download size={13} /> Download the template</button>
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
                onChange={(e) => { setError(""); setFile(e.target.files?.[0] || null); }} />
              {file ? (
                <div className="flex items-center gap-3 border border-gray-200 rounded-xl p-3">
                  <FileSpreadsheet size={22} className="text-emerald-600 shrink-0" />
                  <div className="min-w-0 flex-1 text-sm font-semibold text-gray-800 truncate">{file.name}</div>
                  <button onClick={() => inputRef.current?.click()} disabled={busy} className="text-xs font-semibold text-[#164FA3] hover:underline disabled:opacity-40">Change</button>
                </div>
              ) : (
                <button onClick={() => inputRef.current?.click()} className="w-full border-2 border-dashed border-gray-200 rounded-xl p-6 text-center hover:border-[#164FA3]/40 hover:bg-blue-50/30">
                  <Upload size={22} className="mx-auto text-gray-400 mb-1.5" />
                  <div className="text-sm font-semibold text-gray-700">Choose a file</div>
                  <div className="text-xs text-gray-400 mt-0.5">.xlsx, .xls or .csv</div>
                </button>
              )}
            </>
          )}

          {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2.5 text-sm flex items-start gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{error}</span></div>}

          {data && s && (
            <>
              <div className={`${isResult ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-blue-50 border-blue-100 text-[#164FA3]"} border rounded-xl px-4 py-3 text-sm font-semibold flex items-center gap-2`}>
                {isResult ? <CheckCircle2 size={16} /> : <FileSpreadsheet size={16} />}
                {isResult ? `Done — ${s.updated} contact${s.updated === 1 ? "" : "s"} updated${s.failed ? `, ${s.failed} failed` : ""}.` : `Preview — nothing has been changed yet. Identifier column: ${data.identifier}.`}
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <Tile label="Rows in file" value={s.total_rows} />
                <Tile label="Matched" value={s.matched} />
                <Tile label={isResult ? "Updated" : "To update"} value={isResult ? s.updated : s.to_update} tone="text-emerald-700" />
                <Tile label="No change" value={s.no_change} />
                <Tile label="Not found" value={s.unmatched + s.out_of_scope} tone={s.unmatched + s.out_of_scope ? "text-amber-600" : ""} />
                <Tile label={isResult ? "Errors / failed" : "Errors"} value={s.errors + s.duplicate_identifiers + (s.failed || 0)} tone={s.errors + s.duplicate_identifiers + (s.failed || 0) ? "text-red-600" : ""} />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {[["all", "All"], [isResult ? "updated" : "update", isResult ? "Updated" : "To update"], ["problems", `Problems (${problems})`]].map(([k, l]) => (
                  <button key={k} onClick={() => setShow(k)} className={`px-3 py-1 rounded-lg text-xs font-semibold ${show === k ? "bg-[#164FA3] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{l}</button>
                ))}
              </div>

              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
                  {rows.length === 0 && <div className="p-6 text-center text-sm text-gray-400">Nothing to show here.</div>}
                  {rows.slice(0, 300).map((r) => {
                    const [label, cls] = STATUS_META[r.status] || [r.status, "bg-gray-50 text-gray-500 border-gray-200"];
                    return (
                      <div key={r.row} className="px-3 py-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-gray-400">Row {r.row}</span>
                          <span className="font-semibold text-gray-800 truncate">{r.name || "—"}{r.contact_id ? <span className="text-gray-400 font-normal"> · #{r.contact_id}</span> : null}</span>
                          <span className={`ml-auto shrink-0 border rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{label}</span>
                        </div>
                        {(r.changes || []).length > 0 && (
                          <ul className="mt-1 space-y-0.5 text-gray-600">
                            {r.changes.map((c) => (
                              <li key={c.field} className="break-words"><span className="text-gray-400">{c.label}:</span> {c.from ? <span className="line-through text-gray-400">{c.from}</span> : <span className="text-gray-300">(empty)</span>} → <span className="font-medium text-gray-800">{c.to}</span></li>
                            ))}
                          </ul>
                        )}
                        {(r.errors || []).map((e, i) => <div key={i} className="mt-0.5 text-red-600">{e}</div>)}
                      </div>
                    );
                  })}
                </div>
              </div>
              {(data.truncated || rows.length > 300) && <div className="text-[11px] text-gray-400">Showing the first rows only; the counts above cover the whole file.</div>}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          {isResult ? (
            <button onClick={onClose} className="px-5 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 text-white rounded-lg font-semibold">Done</button>
          ) : data ? (
            <>
              <button onClick={() => { setData(null); setError(""); }} disabled={busy} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50">Back</button>
              <button onClick={() => send(false)} disabled={busy || !s?.to_update} className="px-5 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold inline-flex items-center gap-2">
                {busy && <Loader2 size={15} className="animate-spin" />}{busy ? "Applying…" : `Apply ${s?.to_update || 0} update${s?.to_update === 1 ? "" : "s"}`}
              </button>
            </>
          ) : (
            <>
              <button onClick={onClose} disabled={busy} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50">Cancel</button>
              <button onClick={() => send(true)} disabled={!file || busy} className="px-5 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-60 text-white rounded-lg font-semibold inline-flex items-center gap-2">
                {busy && <Loader2 size={15} className="animate-spin" />}{busy ? "Checking…" : "Preview changes"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
