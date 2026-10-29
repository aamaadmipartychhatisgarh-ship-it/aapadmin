"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ClipboardCheck, AlertCircle } from "lucide-react";
import { qualificationLabel } from "@/lib/qualificationOptions";
import { vehicleLabel } from "@/lib/vehicleOptions";

const TABS = ["Pending", "Correct", "Incorrect"];
const CHIP = { Pending: "bg-amber-50 text-amber-700 border-amber-200", Correct: "bg-emerald-50 text-emerald-700 border-emerald-200", Incorrect: "bg-red-50 text-red-700 border-red-200" };
function fmt(v) {
  const d = v ? new Date(v) : null;
  return d && !isNaN(d) ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(d) : "—";
}

// Super Admin's RfA Review List — contacts submitted for Review for Announce by a
// Supervisor-2. `compact` (dashboard panel) shows only the Pending queue + a link to
// the full page; the full page has Pending / Correct / Incorrect tabs.
export default function RfaReviewList({ compact = false }) {
  const [tab, setTab] = useState("Pending");
  const [data, setData] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/rfa?status=${compact ? "Pending" : tab}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      setData(await r.json()); setErr("");
    } catch { setErr("Could not load the RfA Review List."); }
  }, [tab, compact]);
  useEffect(() => { load(); }, [load]);

  // "Incorrect" opens a reason box first (mandatory); "Correct" saves straight away.
  const [incFor, setIncFor] = useState(null); // review row awaiting a reason
  const [reason, setReason] = useState("");
  const [reasonErr, setReasonErr] = useState("");

  async function decide(row, status, remark = "") {
    setBusyId(row.id); setErr("");
    try {
      const r = await fetch(`/api/rfa/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, remark }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (status === "Incorrect" && r.status === 400) { setReasonErr(d.message || "A reason is required."); return false; }
        setErr(d.message || "Could not update the review.");
      }
      await load();
      return r.ok;
    } catch { setErr("Could not update the review."); }
    finally { setBusyId(null); }
    return false;
  }
  async function submitIncorrect() {
    if (!reason.trim()) { setReasonErr("Please enter the reason this contact is Incorrect."); return; }
    setReasonErr("");
    if (await decide(incFor, "Incorrect", reason.trim())) { setIncFor(null); setReason(""); }
  }

  if (!data) return <div className="py-6 text-center text-gray-400">{err || <Loader2 className="animate-spin inline" size={18} />}</div>;
  const rows = data.reviews;
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" data-testid="rfa-list">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
        <ClipboardCheck size={17} className="text-violet-700" />
        <h2 className="text-sm font-bold text-gray-900">RfA Review List</h2>
        <span className="text-xs font-semibold text-violet-800 bg-violet-100 rounded-full px-2 py-0.5">{data.counts.Pending} pending</span>
        {compact ? (
          <Link href="/dashboard/admin/rfa" className="ml-auto text-xs font-semibold text-[#164FA3] hover:underline">Open full list</Link>
        ) : (
          <div className="ml-auto flex gap-1">
            {TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)} data-testid={`rfa-tab-${t}`}
                className={`px-3 py-1 rounded-lg text-xs font-semibold border ${tab === t ? "bg-[#164FA3] text-white border-[#164FA3]" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                {t} · {data.counts[t]}
              </button>
            ))}
          </div>
        )}
      </div>
      {err && <div className="px-4 py-2 text-sm text-red-700 bg-red-50">{err}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[1100px]">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Contact Name</th>
              <th className="px-4 py-2 font-semibold">Phone Number</th>
              <th className="px-4 py-2 font-semibold">Qualification</th>
              <th className="px-4 py-2 font-semibold">Assembly</th>
              <th className="px-4 py-2 font-semibold">District</th>
              <th className="px-4 py-2 font-semibold">Lok Sabha</th>
              <th className="px-4 py-2 font-semibold">Remark / Notes</th>
              <th className="px-4 py-2 font-semibold">Vehicle</th>
              <th className="px-4 py-2 font-semibold">Submitted By (Supervisor-2)</th>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="px-4 py-2 font-semibold text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && <tr><td colSpan={12} className="px-4 py-8 text-center text-gray-400">{compact ? "No RfA reviews pending." : `No ${tab.toLowerCase()} RfA reviews.`}</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} data-testid="rfa-row">
                <td className="px-4 py-2.5 align-top">
                  <div className="font-medium text-gray-900" data-testid="rfa-name">{r.person_name || `Contact #${r.contact_id} (no longer exists)`}</div>
                  {r.designation_name && <div className="text-xs text-gray-500">{r.designation_name}</div>}
                </td>
                <td className="px-4 py-2.5 align-top text-gray-700 font-mono text-xs whitespace-nowrap" data-testid="rfa-phone">{r.phone_number || "—"}</td>
                <td className="px-4 py-2.5 align-top text-gray-700" data-testid="rfa-qualification">{qualificationLabel(r.qualification, r.education_level) || "—"}</td>
                <td className="px-4 py-2.5 align-top text-gray-700" data-testid="rfa-assembly">{r.assembly_name || "—"}</td>
                <td className="px-4 py-2.5 align-top text-gray-700" data-testid="rfa-district">{r.district_name || "—"}</td>
                <td className="px-4 py-2.5 align-top text-gray-700" data-testid="rfa-lok-sabha">{r.lok_sabha_name || "—"}</td>
                <td className="px-4 py-2.5 align-top text-gray-700 max-w-[260px] whitespace-pre-wrap break-words" data-testid="rfa-contact-remarks">{r.contact_remarks || "—"}</td>
                <td className="px-4 py-2.5 align-top text-gray-700" data-testid="rfa-vehicle">{vehicleLabel(r.vehicle) || "—"}</td>
                <td className="px-4 py-2.5 align-top"><div className="text-gray-900">{r.submitted_by_name || "—"}</div><div className="text-[11px] text-gray-400">{fmt(r.submitted_at)}</div></td>
                <td className="px-4 py-2.5 align-top">
                  <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full border ${CHIP[r.status] || ""}`}>{r.status}</span>
                  {r.status !== "Pending" && <div className="text-[11px] text-gray-400 mt-0.5">{r.reviewed_by_name} · {fmt(r.reviewed_at)}</div>}
                  {r.status !== "Pending" && r.review_remark && <div className={`text-xs mt-0.5 max-w-[240px] whitespace-pre-wrap break-words ${r.status === "Incorrect" ? "text-red-700" : "text-gray-600"}`} data-testid="rfa-remark">{r.status === "Incorrect" ? "Reason: " : "Remark: "}{r.review_remark}</div>}
                </td>
                <td className="px-4 py-2.5 align-top text-right whitespace-nowrap">
                  {r.status === "Pending" && (
                    <>
                      <button onClick={() => decide(r, "Correct")} disabled={busyId === r.id} data-testid="rfa-correct" title="Mark Correct" className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded-lg font-medium disabled:opacity-50">✅ Correct</button>
                      <button onClick={() => { setIncFor(r); setReason(""); setReasonErr(""); }} disabled={busyId === r.id} data-testid="rfa-incorrect" title="Mark Incorrect (reason required)" className="inline-flex items-center gap-1 text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg font-medium disabled:opacity-50">❌ Incorrect</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {incFor && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setIncFor(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()} data-testid="rfa-incorrect-dialog">
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2"><AlertCircle size={18} className="text-red-600" /> Mark Incorrect</h3>
            <p className="text-sm text-gray-500 mt-1">{incFor.person_name || `Contact #${incFor.contact_id}`} — tell the supervisor what is wrong.</p>
            <label className="block text-xs font-medium text-gray-500 mt-3 mb-1">Remark / Reason <span className="text-red-500">*</span></label>
            <textarea value={reason} onChange={(e) => { setReason(e.target.value); if (reasonErr) setReasonErr(""); }} rows={3} autoFocus data-testid="rfa-reason"
              className="w-full rounded-lg border border-gray-200 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-red-300" placeholder="e.g. Phone number is wrong" />
            {reasonErr && <p className="text-xs text-red-600 mt-1" data-testid="rfa-reason-error">{reasonErr}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setIncFor(null)} className="h-9 px-4 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={submitIncorrect} disabled={busyId === incFor.id} data-testid="rfa-incorrect-submit" className="h-9 px-4 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60">Save as Incorrect</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
