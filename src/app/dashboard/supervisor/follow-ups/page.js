"use client";

import { useEffect, useState } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import { Star, Search } from "lucide-react";

export default function Page() {
  return <SupervisorGuard><Body /></SupervisorGuard>;
}

function Body() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [vipOnly, setVipOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);

  useEffect(() => {
    fetch("/api/supervisor/follow-ups")
      .then((r) => r.json())
      .then((d) => setRows(d.follow_ups || []))
      .finally(() => setLoading(false));
  }, []);

  const today = new Date().toISOString().slice(0, 10);

  // Client-side filters — the full list is already loaded.
  const agents = [...new Set(rows.map((r) => r.agent_name).filter(Boolean))].sort();
  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => {
    const date = r.follow_up_date ? r.follow_up_date.slice(0, 10) : null;
    return (!q || (r.person_name || "").toLowerCase().includes(q) || (r.phone_number || "").includes(q)) &&
      (!agentFilter || r.agent_name === agentFilter) &&
      (!vipOnly || r.is_vip) &&
      (!overdueOnly || (date && date < today));
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Follow-Ups</h1>
        <p className="text-gray-500 mt-2 font-medium">VIPs are pinned to the top. Overdue dates highlighted in red.</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex items-center gap-3 flex-wrap">
        <Search size={18} className="text-gray-400 ml-2" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or phone" className="flex-1 min-w-[180px] outline-none text-sm py-2" />
        <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">All agents</option>
          {agents.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input type="checkbox" checked={vipOnly} onChange={(e) => setVipOnly(e.target.checked)} /> VIP only
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only
        </label>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-gray-400">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-gray-400">No pending follow-ups{rows.length ? " match the filters" : ""}.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600"></th>
                <th className="px-4 py-3 font-semibold text-gray-600">Person</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Phone</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Agent</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Follow-up date</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Sentiment</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const date = r.follow_up_date ? r.follow_up_date.slice(0, 10) : null;
                const overdue = date && date < today;
                return (
                  <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      {r.is_vip ? <Star size={16} className="text-[#FCB712] fill-[#FCB712]" /> : null}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{r.person_name}</td>
                    <td className="px-4 py-3 text-gray-600">{r.phone_number}</td>
                    <td className="px-4 py-3 text-gray-600">{r.agent_name || "—"}</td>
                    <td className={`px-4 py-3 ${overdue ? "text-red-600 font-bold" : "text-gray-700"}`}>
                      {date || "—"}{overdue ? " (overdue)" : ""}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{r.sentiment || "—"}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{r.remarks || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
