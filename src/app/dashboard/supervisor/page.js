"use client";

import { useEffect, useState } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { PhoneCall, PhoneForwarded, PhoneOff, AlertTriangle, Download, Award } from "lucide-react";

const BUCKET_LABELS = {
  connected: "Connected",
  no_answer: "No Answer",
  wrong_number: "Wrong Number",
  rejected: "Rude/Rejected",
  busy: "Busy",
  switched_off: "Switched Off",
  other: "Other",
};
const BUCKET_COLORS = {
  connected: "#10B981",
  no_answer: "#F59E0B",
  wrong_number: "#6B7280",
  rejected: "#EF4444",
  busy: "#8B5CF6",
  switched_off: "#0EA5E9",
  other: "#A1A1AA",
};

export default function SupervisorOverview() {
  return (
    <SupervisorGuard>
      <OverviewBody />
    </SupervisorGuard>
  );
}

function OverviewBody() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/supervisor/summary")
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-gray-400">Loading…</div>;
  }
  if (!data || !data.tally) return <div className="text-gray-400">{data?.message ?? "No data"}</div>;

  const { tally, hourly, timeline, best_caller } = data;
  const cards = [
    { label: "Total Calls", value: tally.total, icon: PhoneCall, color: "bg-[#164FA3]", text: "text-white" },
    { label: "Connected", value: tally.connected, icon: PhoneForwarded, color: "bg-white", text: "text-gray-900" },
    { label: "No Answer", value: tally.no_answer, icon: PhoneOff, color: "bg-white", text: "text-gray-900" },
    { label: "Wrong Number", value: tally.wrong_number, icon: AlertTriangle, color: "bg-white", text: "text-gray-900" },
  ];
  const pieData = Object.entries(tally)
    .filter(([k, v]) => k !== "total" && v > 0)
    .map(([k, v]) => ({ name: BUCKET_LABELS[k], value: v, color: BUCKET_COLORS[k] }));

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-[2.5rem] font-bold text-gray-900 tracking-tight leading-none">Supervisor Overview</h1>
          <p className="text-gray-500 mt-3 font-medium">Team performance & calling activity</p>
        </div>
        <a
          href="/api/supervisor/export/summary"
          className="inline-flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded text-sm font-medium shadow-sm"
        >
          <Download size={16} /> Export PDF
        </a>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className={`${c.color} rounded-2xl p-6 shadow-sm border border-gray-100 flex flex-col gap-4`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${c.color === "bg-[#164FA3]" ? "bg-white/20 text-white" : "bg-gray-100 text-[#164FA3]"}`}>
                <Icon size={20} />
              </div>
              <div>
                <h3 className={`text-3xl font-bold tracking-tighter ${c.text}`}>{c.value}</h3>
                <p className={`text-sm font-medium mt-1 ${c.color === "bg-[#164FA3]" ? "text-blue-200" : "text-gray-500"}`}>{c.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h2 className="font-bold text-lg text-gray-900 mb-6">Calls Over Time</h2>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timeline}>
                <CartesianGrid stroke="#eee" strokeDasharray="5 5" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "#6B7280", fontSize: 12 }} />
                <YAxis tick={{ fill: "#6B7280", fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#164FA3" strokeWidth={3} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h2 className="font-bold text-lg text-gray-900 mb-6">Status Breakdown</h2>
          <div className="h-[300px]">
            {pieData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-400">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} innerRadius={80} outerRadius={110} paddingAngle={4} dataKey="value">
                    {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 lg:col-span-2">
          <h2 className="font-bold text-lg text-gray-900 mb-6">Hourly Productivity</h2>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourly}>
                <CartesianGrid stroke="#eee" strokeDasharray="5 5" vertical={false} />
                <XAxis dataKey="hour" tick={{ fill: "#6B7280", fontSize: 12 }} tickFormatter={(h) => `${h}:00`} />
                <YAxis tick={{ fill: "#6B7280", fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="calls" fill="#164FA3" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-[#FCB712]/10 text-[#FCB712] flex items-center justify-center">
              <Award size={20} />
            </div>
            <span className="font-bold text-gray-900">Best Caller</span>
          </div>
          {best_caller ? (
            <>
              <h3 className="text-3xl font-bold text-gray-900 tracking-tighter">{best_caller.name}</h3>
              <p className="text-sm text-gray-500 mt-1 font-medium">{best_caller.calls} calls in range</p>
            </>
          ) : (
            <p className="text-gray-400 text-sm">No calls in range</p>
          )}
        </div>
      </div>
    </div>
  );
}
