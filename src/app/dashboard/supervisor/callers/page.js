"use client";

import { useEffect, useState } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import { Download, Trophy } from "lucide-react";

export default function Page() {
  return <SupervisorGuard><CallersBody /></SupervisorGuard>;
}

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
const TODAY = () => new Date().toISOString().slice(0, 10);

const PRESETS = [
  { key: "today", label: "Today", from: () => TODAY(), to: () => TODAY() },
  { key: "7d", label: "Last 7 days", from: () => isoDaysAgo(6), to: () => TODAY() },
  { key: "30d", label: "Last 30 days", from: () => isoDaysAgo(29), to: () => TODAY() },
  { key: "all", label: "All time", from: () => "", to: () => "" },
];

function CallersBody() {
  const [callers, setCallers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (from) p.set("date_from", from);
    if (to) p.set("date_to", to);
    fetch(`/api/supervisor/callers?${p}`)
      .then((r) => r.json())
      .then((d) => setCallers(d.callers || []))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  function applyPreset(pk) {
    setPreset(pk);
    const found = PRESETS.find((x) => x.key === pk);
    setFrom(found.from());
    setTo(found.to());
  }

  const exportParams = new URLSearchParams();
  if (from) exportParams.set("date_from", from);
  if (to) exportParams.set("date_to", to);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Caller Performance</h1>
          <p className="text-gray-500 mt-2 font-medium">Ranked by total calls. Includes connected, follow-ups, avg duration.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {PRESETS.map((p) => (
              <button key={p.key} onClick={() => applyPreset(p.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${preset === p.key ? "bg-[#164FA3] text-white" : "text-gray-600 hover:bg-gray-200"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <input type="date" value={from} onChange={(e) => { setPreset("custom"); setFrom(e.target.value); }} className="h-9 px-2 rounded-lg border border-gray-200 text-sm" />
          <span className="text-gray-400 text-sm">→</span>
          <input type="date" value={to} onChange={(e) => { setPreset("custom"); setTo(e.target.value); }} className="h-9 px-2 rounded-lg border border-gray-200 text-sm" />
          <a href={`/api/supervisor/export/callers?${exportParams}`} className="inline-flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded text-sm font-medium shadow-sm">
            <Download size={16} /> Export PDF
          </a>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-gray-400">Loading…</div>
        ) : callers.length === 0 ? (
          <div className="p-8 text-gray-400">No callers found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600">#</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Caller</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Total</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Connected</th>
                <th className="px-4 py-3 font-semibold text-gray-600">No Answer</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Wrong #</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Rejected</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Avg Dur</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Follow-Ups</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Interested</th>
              </tr>
            </thead>
            <tbody>
              {callers.map((c) => (
                <tr key={c.user_id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-bold text-gray-700">
                    {c.rank === 1 ? <Trophy size={16} className="inline text-[#FCB712] -mt-1" /> : c.rank}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3 font-bold">{c.total_calls}</td>
                  <td className="px-4 py-3 text-emerald-600">{c.connected || 0}</td>
                  <td className="px-4 py-3 text-amber-600">{c.no_answer || 0}</td>
                  <td className="px-4 py-3 text-gray-500">{c.wrong_number || 0}</td>
                  <td className="px-4 py-3 text-red-600">{c.rejected || 0}</td>
                  <td className="px-4 py-3 text-gray-700">{c.avg_duration_seconds ? `${c.avg_duration_seconds}s` : "—"}</td>
                  <td className="px-4 py-3 text-blue-600">{c.pending_follow_ups || 0}</td>
                  <td className="px-4 py-3 text-emerald-700 font-medium">{c.interested || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
