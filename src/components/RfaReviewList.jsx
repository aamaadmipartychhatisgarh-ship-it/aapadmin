"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, X, Loader2, ClipboardCheck } from "lucide-react";
import { qualificationLabel } from "@/lib/qualificationOptions";
import { vehicleLabel } from "@/lib/vehicleOptions";

const TABS = ["Pending", "Approved", "Rejected"];
const CHIP = { Pending: "bg-amber-50 text-amber-700 border-amber-200", Approved: "bg-emerald-50 text-emerald-700 border-emerald-200", Rejected: "bg-red-50 text-red-700 border-red-200" };
function fmt(v) {
  const d = v ? new Date(v) : null;
  return d && !isNaN(d) ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(d) : "—";
}

// Super Admin's RfA Review List — contacts submitted for Review for Announce by a
// Supervisor-2. `compact` (dashboard panel) shows only the Pending queue + a link to
// the full page; the full page has Pending / Approved / Rejected tabs.
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

  async function decide(row, status) {
    let remark = "";
    if (status === "Rejected") { remark = window.prompt(`Reason for rejecting ${row.person_name} (optional):`, "") ?? null; if (remark === null) return; }
    setBusyId(row.id); setErr("");
    try {
      const r = await fetch(`/api/rfa/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, remark }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErr(d.message || "Could not update the review.");
      await load();
    } catch { setErr("Could not update the review."); }
    finally { setBusyId(null); }
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
              <th className="px-4 py-2 font-semibold">Zone</th>
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
                <td className="px-4 py-2.5 align-top text-gray-700" data-testid="rfa-zone">{r.zone_name || "—"}</td>
                <td className="px-4 py-2.5 align-top text-gray-700" data-testid="rfa-vehicle">{vehicleLabel(r.vehicle) || "—"}</td>
                <td className="px-4 py-2.5 align-top"><div className="text-gray-900">{r.submitted_by_name || "—"}</div><div className="text-[11px] text-gray-400">{fmt(r.submitted_at)}</div></td>
                <td className="px-4 py-2.5 align-top">
                  <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full border ${CHIP[r.status] || ""}`}>{r.status}</span>
                  {r.status !== "Pending" && <div className="text-[11px] text-gray-400 mt-0.5">{r.reviewed_by_name} · {fmt(r.reviewed_at)}{r.review_remark ? ` — ${r.review_remark}` : ""}</div>}
                </td>
                <td className="px-4 py-2.5 align-top text-right whitespace-nowrap">
                  {r.status === "Pending" && (
                    <>
                      <button onClick={() => decide(r, "Approved")} disabled={busyId === r.id} data-testid="rfa-approve" className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded-lg font-medium disabled:opacity-50"><Check size={14} /> Approve</button>
                      <button onClick={() => decide(r, "Rejected")} disabled={busyId === r.id} data-testid="rfa-reject" className="inline-flex items-center gap-1 text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg font-medium disabled:opacity-50"><X size={14} /> Reject</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
