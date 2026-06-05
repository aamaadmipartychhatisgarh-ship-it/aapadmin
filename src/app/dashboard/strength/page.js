"use client";

import { useEffect, useState } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import { Gauge, Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react";

export default function Page() {
  return <SupervisorGuard><Body /></SupervisorGuard>;
}

const BAND = {
  strong: { label: "Strong", color: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", icon: TrendingUp },
  medium: { label: "Medium", color: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", icon: Minus },
  weak: { label: "Weak", color: "bg-red-500", text: "text-red-700", bg: "bg-red-50", icon: TrendingDown },
};

function Body() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { fetch("/api/strength").then((r) => r.json()).then(setData).finally(() => setLoading(false)); }, []);
  if (loading || !data) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  const s = data.summary;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Organization Strength</h1>
        <p className="text-gray-500 mt-2 font-medium">Composite score: workers, activity, teams & calling per district.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {["strong", "medium", "weak"].map((b) => {
          const meta = BAND[b]; const Icon = meta.icon;
          return (
            <div key={b} className={`${meta.bg} rounded-2xl p-5 border border-gray-100`}>
              <div className="flex items-center gap-2 mb-2"><Icon size={18} className={meta.text} /><span className={`font-bold ${meta.text}`}>{meta.label} Areas</span></div>
              <div className="text-3xl font-bold text-gray-900">{s[b]}</div>
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center gap-2"><Gauge size={18} className="text-[#164FA3]" /><h2 className="font-bold text-gray-900">District Strength Ranking</h2></div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-4 py-3 font-semibold text-gray-600">#</th>
              <th className="px-4 py-3 font-semibold text-gray-600">District</th>
              <th className="px-4 py-3 font-semibold text-gray-600">Workers</th>
              <th className="px-4 py-3 font-semibold text-gray-600">Avg Activity</th>
              <th className="px-4 py-3 font-semibold text-gray-600">Teams</th>
              <th className="px-4 py-3 font-semibold text-gray-600">Calls</th>
              <th className="px-4 py-3 font-semibold text-gray-600 w-64">Strength</th>
            </tr>
          </thead>
          <tbody>
            {data.areas.map((a, i) => {
              const meta = BAND[a.band];
              return (
                <tr key={a.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-400 font-bold">{i + 1}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{a.name}</td>
                  <td className="px-4 py-3 text-gray-600">{a.worker_count}</td>
                  <td className="px-4 py-3 text-gray-600">{a.avg_activity}</td>
                  <td className="px-4 py-3 text-gray-600">{a.team_count}</td>
                  <td className="px-4 py-3 text-gray-600">{a.call_count}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${meta.color}`} style={{ width: `${a.score}%` }} /></div>
                      <span className="font-bold text-gray-700 w-8">{a.score}</span>
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${meta.bg} ${meta.text}`}>{meta.label}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
