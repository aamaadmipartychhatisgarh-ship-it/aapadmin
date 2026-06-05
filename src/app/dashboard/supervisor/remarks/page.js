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

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Caller Remarks</h1>
        <p className="text-gray-500 mt-2 font-medium">Free-text notes captured during calls. Search across all calls below.</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex items-center gap-3">
        <Search size={18} className="text-gray-400 ml-2" />
        <input
          type="text"
          placeholder="Search remarks (e.g. 'water', 'MLA', 'join')"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 outline-none text-sm py-2"
        />
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
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
              {rows.map((r) => (
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
