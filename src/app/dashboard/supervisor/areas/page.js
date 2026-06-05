"use client";

import { useEffect, useState } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import { Download } from "lucide-react";

const LEVELS = [
  { key: "zone", label: "Zone" },
  { key: "lok_sabha", label: "Lok Sabha" },
  { key: "district", label: "District" },
  { key: "assembly", label: "Vidhan Sabha" },
  { key: "ward", label: "Ward" },
  { key: "booth", label: "Booth" },
];

export default function Page() {
  return <SupervisorGuard><AreasBody /></SupervisorGuard>;
}

function AreasBody() {
  const [level, setLevel] = useState("district");
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/supervisor/areas?level=${level}`)
      .then((r) => r.json())
      .then((d) => setAreas(d.areas || []))
      .finally(() => setLoading(false));
  }, [level]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Area Reports</h1>
          <p className="text-gray-500 mt-2 font-medium">Group calling activity by political geography.</p>
        </div>
        <a href="/api/supervisor/export/areas" className="inline-flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded text-sm font-medium shadow-sm">
          <Download size={16} /> Export PDF (Districts)
        </a>
      </div>

      <div className="flex gap-2">
        {LEVELS.map((l) => (
          <button
            key={l.key}
            onClick={() => setLevel(l.key)}
            className={`px-4 py-2 rounded text-sm font-medium ${level === l.key ? "bg-[#164FA3] text-white" : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"}`}
          >
            {l.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-gray-400">Loading…</div>
        ) : areas.length === 0 ? (
          <div className="p-8 text-gray-400">No areas at this level.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600">Area</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Total</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Connected</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Positive</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Negative</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Neutral</th>
              </tr>
            </thead>
            <tbody>
              {areas.map((a) => (
                <tr key={a.area_id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{a.area_name}</td>
                  <td className="px-4 py-3 font-bold">{a.total_calls}</td>
                  <td className="px-4 py-3 text-emerald-600">{a.connected || 0}</td>
                  <td className="px-4 py-3 text-emerald-700">{a.positive || 0}</td>
                  <td className="px-4 py-3 text-red-600">{a.negative || 0}</td>
                  <td className="px-4 py-3 text-gray-600">{a.neutral || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
