"use client";

import { useEffect, useState } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import { Search } from "lucide-react";

export default function Page() {
  return <SupervisorGuard><Body /></SupervisorGuard>;
}

function Body() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [districtFilter, setDistrictFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`/api/supervisor/remarks?search=${encodeURIComponent(search)}`)
        .then((r) => r.json())
        .then((d) => setRows(d.remarks || []))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  // Agent/district filters applied client-side over the fetched rows.
  const agents = [...new Set(rows.map((r) => r.agent_name).filter(Boolean))].sort();
  const districtNames = [...new Set(rows.map((r) => r.district_name).filter(Boolean))].sort();
  const visible = rows.filter((r) =>
    (!agentFilter || r.agent_name === agentFilter) &&
    (!districtFilter || r.district_name === districtFilter)
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Caller Remarks</h1>
        <p className="text-gray-500 mt-2 font-medium">Free-text notes captured during calls. Search across all calls below.</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex items-center gap-3 flex-wrap">
        <Search size={18} className="text-gray-400 ml-2" />
        <input
          type="text"
          placeholder="Search remarks (e.g. 'water', 'MLA', 'join')"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] outline-none text-sm py-2"
        />
        <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">All agents</option>
          {agents.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={districtFilter} onChange={(e) => setDistrictFilter(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">All districts</option>
          {districtNames.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-gray-400">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-gray-400">No remarks found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600">Date</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Person</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Agent</th>
                <th className="px-4 py-3 font-semibold text-gray-600">District</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50 align-top">
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{new Date(r.called_at).toLocaleString("en-GB")}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{r.person_name}</td>
                  <td className="px-4 py-3 text-gray-600">{r.agent_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{r.district_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{r.status_name}</td>
                  <td className="px-4 py-3 text-gray-700 max-w-md">{r.remarks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
