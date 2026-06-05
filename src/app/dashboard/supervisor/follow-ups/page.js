"use client";

import { useEffect, useState } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import { Star } from "lucide-react";

export default function Page() {
  return <SupervisorGuard><Body /></SupervisorGuard>;
}

function Body() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/supervisor/follow-ups")
      .then((r) => r.json())
      .then((d) => setRows(d.follow_ups || []))
      .finally(() => setLoading(false));
  }, []);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Follow-Ups</h1>
        <p className="text-gray-500 mt-2 font-medium">VIPs are pinned to the top. Overdue dates highlighted in red.</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-gray-400">No pending follow-ups.</div>
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
              {rows.map((r) => {
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
