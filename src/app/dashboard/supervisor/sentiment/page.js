"use client";

import { useEffect, useState } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

const COLORS = {
  positive:  "#10B981",
  supporter: "#059669",
  neutral:   "#9CA3AF",
  negative:  "#F97316",
  opponent:  "#DC2626",
};
const LABELS = {
  positive:  "Positive",
  supporter: "Supporter",
  neutral:   "Neutral",
  negative:  "Negative",
  opponent:  "Opponent",
};

export default function Page() {
  return <SupervisorGuard><Body /></SupervisorGuard>;
}

function Body() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/supervisor/sentiment")
      .then((r) => r.json())
      .then((d) => setData(d.sentiment))
      .finally(() => setLoading(false));
  }, []);

  const pie = data ? Object.entries(data)
    .filter(([_, v]) => v > 0)
    .map(([k, v]) => ({ name: LABELS[k], value: v, color: COLORS[k] })) : [];
  const total = data ? Object.values(data).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Public Sentiment</h1>
        <p className="text-gray-500 mt-2 font-medium">Distribution of caller-reported sentiment across all logged calls.</p>
      </div>

      {loading ? (
        <div className="text-gray-400">Loading…</div>
      ) : total === 0 ? (
        <div className="bg-white p-12 rounded-2xl border border-gray-100 text-center text-gray-400">
          No sentiment recorded yet. Sentiment is captured on the "Log a Call" form.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <h2 className="font-bold text-lg text-gray-900 mb-6">Distribution</h2>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pie} innerRadius={80} outerRadius={120} dataKey="value" paddingAngle={3}>
                    {pie.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <h2 className="font-bold text-lg text-gray-900 mb-6">Counts</h2>
            <ul className="space-y-3">
              {Object.entries(data).map(([k, v]) => (
                <li key={k} className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <span className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full" style={{ background: COLORS[k] }} />
                    <span className="font-medium text-gray-800">{LABELS[k]}</span>
                  </span>
                  <span className="font-bold text-gray-900">{v}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
