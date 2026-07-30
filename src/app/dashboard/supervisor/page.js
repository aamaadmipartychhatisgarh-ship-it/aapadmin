"use client";

import { useEffect, useState, useMemo } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { PhoneCall, PhoneForwarded, PhoneOff, PowerOff, Clock, AlertTriangle, ThumbsDown, CalendarClock, Download, Award, Calendar } from "lucide-react";

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

// Hour label in 12-hour form (0 -> "12 AM", 13 -> "1 PM"). Hours arrive already
// in the application timezone (IST) from the API.
function fmtHour(h) {
  const hr = Number(h);
  const period = hr < 12 ? "AM" : "PM";
  const display = hr % 12 === 0 ? 12 : hr % 12;
  return `${display} ${period}`;
}

// Date helpers in the application timezone (Asia/Kolkata) so presets match the
// server's notion of "today" regardless of the browser's timezone.
const istFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const istDateStr = (d) => istFmt.format(d);
const DAY = 86400000;
function istToday() { return istDateStr(new Date()); }
function shiftDays(days) { return istDateStr(new Date(Date.now() + days * DAY)); }
function monthStart() { return istToday().slice(0, 8) + "01"; }

const PRESETS = [
  { key: "today", label: "Today", range: () => ({ from: istToday(), to: istToday() }) },
  { key: "yesterday", label: "Yesterday", range: () => ({ from: shiftDays(-1), to: shiftDays(-1) }) },
  { key: "7d", label: "Last 7 Days", range: () => ({ from: shiftDays(-6), to: istToday() }) },
  { key: "30d", label: "Last 30 Days", range: () => ({ from: shiftDays(-29), to: istToday() }) },
  { key: "month", label: "This Month", range: () => ({ from: monthStart(), to: istToday() }) },
  { key: "custom", label: "Custom Range", range: null },
];

// dd-MMM-yyyy for display.
function prettyDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d}-${months[Number(m) - 1]}-${y}`;
}

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
  const [preset, setPreset] = useState("today");
  const [custom, setCustom] = useState({ from: istToday(), to: istToday() });

  // Resolve the active range from the preset (or the custom inputs).
  const range = useMemo(() => {
    if (preset === "custom") return { from: custom.from, to: custom.to };
    return PRESETS.find((p) => p.key === preset).range();
  }, [preset, custom]);

  const isToday = range.from === istToday() && range.to === istToday();

  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams();
    if (range.from) qs.set("date_from", range.from);
    if (range.to) qs.set("date_to", range.to);
    const load = () => {
      fetch(`/api/supervisor/summary?${qs.toString()}`)
        .then((r) => r.json())
        .then((d) => { if (alive) setData(d); })
        .catch(() => {})
        .finally(() => { if (alive) setLoading(false); });
    };
    setLoading(true);
    load();
    // Live auto-refresh only while viewing today's data (every 45s), so numbers
    // stay current without a manual refresh. Historical views are static.
    const id = isToday ? setInterval(load, 45000) : null;
    return () => { alive = false; if (id) clearInterval(id); };
  }, [range.from, range.to, isToday]);

  const tally = data?.tally;

  const cards = [
    { label: "Total Calls", value: tally?.total, icon: PhoneCall, accent: "bg-[#164FA3]", primary: true },
    { label: "Connected", value: tally?.connected, icon: PhoneForwarded, accent: "text-emerald-600 bg-emerald-50" },
    { label: "Not Picked", value: tally?.no_answer, icon: PhoneOff, accent: "text-amber-600 bg-amber-50" },
    { label: "Switched Off", value: tally?.switched_off, icon: PowerOff, accent: "text-sky-600 bg-sky-50" },
    { label: "Busy Calls", value: tally?.busy, icon: Clock, accent: "text-violet-600 bg-violet-50" },
    { label: "Wrong Number", value: tally?.wrong_number, icon: AlertTriangle, accent: "text-gray-600 bg-gray-100" },
    { label: "Rude/Rejected", value: tally?.rejected, icon: ThumbsDown, accent: "text-red-600 bg-red-50" },
    { label: "Follow-up Scheduled", value: tally?.follow_up, icon: CalendarClock, accent: "text-[#FCB712] bg-[#FCB712]/10" },
  ];

  const pieData = tally
    ? Object.entries(tally)
        .filter(([k, v]) => !["total", "follow_up"].includes(k) && v > 0)
        .map(([k, v]) => ({ name: BUCKET_LABELS[k], value: v, color: BUCKET_COLORS[k] }))
    : [];

  const timeline = data?.timeline ?? [];
  const hourly = data?.hourly ?? [];
  const best_caller = data?.best_caller;

  const rangeLabel = isToday
    ? "Today"
    : range.from === range.to
    ? prettyDate(range.from)
    : `${prettyDate(range.from)} → ${prettyDate(range.to)}`;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h1 className="text-[2.5rem] font-bold text-gray-900 tracking-tight leading-none">Supervisor Overview</h1>
          <p className="text-gray-500 mt-3 font-medium">
            Live calling performance · <span className="font-semibold text-gray-700">{rangeLabel}</span>
            {isToday && <span className="ml-2 inline-flex items-center gap-1 text-emerald-600 text-xs font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live</span>}
          </p>
        </div>
        {/* Report date / range filter */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 h-10 shadow-sm">
            <Calendar size={16} className="text-[#164FA3]" />
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
              className="text-sm text-gray-900 bg-transparent outline-none font-medium"
            >
              {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          {preset === "custom" && (
            <div className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 h-10 shadow-sm">
              <input type="date" value={custom.from} max={custom.to || istToday()}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                className="text-sm text-gray-900 bg-transparent outline-none" />
              <span className="text-gray-400 text-sm">→</span>
              <input type="date" value={custom.to} min={custom.from} max={istToday()}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                className="text-sm text-gray-900 bg-transparent outline-none" />
            </div>
          )}
          <a
            href={`/api/supervisor/export/summary?date_from=${range.from}&date_to=${range.to}`}
            className="inline-flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 h-10 rounded-lg text-sm font-medium shadow-sm"
          >
            <Download size={16} /> Export PDF
          </a>
        </div>
      </div>

      {loading && !data ? (
        <div className="text-gray-400">Loading…</div>
      ) : !tally ? (
        <div className="text-gray-400">{data?.message ?? "No data"}</div>
      ) : (
        <>
          {/* 8 daily KPI cards */}
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              {isToday ? "Today's Calling Summary" : "Calling Summary"}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {cards.map((c) => {
                const Icon = c.icon;
                if (c.primary) {
                  return (
                    <div key={c.label} className="bg-[#164FA3] rounded-2xl p-5 shadow-sm flex flex-col gap-3">
                      <div className="w-10 h-10 rounded-full bg-white/20 text-white flex items-center justify-center"><Icon size={20} /></div>
                      <div>
                        <h3 className="text-3xl font-bold tracking-tighter text-white">{(c.value ?? 0).toLocaleString()}</h3>
                        <p className="text-sm font-medium mt-1 text-blue-200">{c.label}</p>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={c.label} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex flex-col gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${c.accent}`}><Icon size={20} /></div>
                    <div>
                      <h3 className="text-3xl font-bold tracking-tighter text-gray-900">{(c.value ?? 0).toLocaleString()}</h3>
                      <p className="text-sm font-medium mt-1 text-gray-500">{c.label}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="font-bold text-lg text-gray-900 mb-6">Calls Over Time</h2>
              <div className="h-[300px]">
                {timeline.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-gray-400">No calls in range</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={timeline}>
                      <CartesianGrid stroke="#eee" strokeDasharray="5 5" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: "#6B7280", fontSize: 12 }} tickFormatter={prettyDate} />
                      <YAxis tick={{ fill: "#6B7280", fontSize: 12 }} />
                      <Tooltip labelFormatter={prettyDate} />
                      <Line type="monotone" dataKey="count" stroke="#164FA3" strokeWidth={3} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
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
                {hourly.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-gray-400">No calls in range</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourly}>
                      <CartesianGrid stroke="#eee" strokeDasharray="5 5" vertical={false} />
                      <XAxis dataKey="hour" tick={{ fill: "#6B7280", fontSize: 12 }} tickFormatter={fmtHour} />
                      <YAxis tick={{ fill: "#6B7280", fontSize: 12 }} />
                      <Tooltip labelFormatter={fmtHour} />
                      <Bar dataKey="calls" fill="#164FA3" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
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
                  <p className="text-sm text-gray-500 mt-1 font-medium">{best_caller.calls.toLocaleString()} calls in range</p>
                </>
              ) : (
                <p className="text-gray-400 text-sm">No calls in range</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
