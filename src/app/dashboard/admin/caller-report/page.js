"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, Phone, PhoneCall, TrendingUp, CalendarDays, Users, Clock, Star } from "lucide-react";
import { isAdmin } from "@/lib/permissions";

export default function Page() {
  const { data: session, status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && !isAdmin(session)) router.push("/dashboard");
  }, [status, session, router]);
  if (status !== "authenticated" || !isAdmin(session)) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <Body />;
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

function Body() {
  const [preset, setPreset] = useState("30d");
  const [from, setFrom] = useState(isoDaysAgo(29));
  const [to, setTo] = useState(TODAY());
  const [data, setData] = useState({ callers: [], totals: {}, daily: [] });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const p = new URLSearchParams();
    if (from) p.set("date_from", from);
    if (to) p.set("date_to", to);
    const r = await fetch(`/api/admin/caller-report?${p}`);
    if (r.ok) setData(await r.json());
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to]);

  function applyPreset(pk) {
    setPreset(pk);
    const preset = PRESETS.find((x) => x.key === pk);
    setFrom(preset.from());
    setTo(preset.to());
  }

  const t = data.totals || {};
  const maxDay = Math.max(1, ...(data.daily || []).map((d) => d.total_calls));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Caller Report</h1>
          <p className="text-gray-500 mt-2 font-medium">Call volume, connect rate, outcomes and ranking per caller.</p>
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
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Tile icon={Users} label="Callers" value={t.callers ?? 0} color="text-[#164FA3]" bg="bg-blue-50" />
        <Tile icon={Phone} label="Total Calls" value={(t.total_calls ?? 0).toLocaleString()} color="text-indigo-700" bg="bg-indigo-50" />
        <Tile icon={PhoneCall} label="Connected" value={(t.connected ?? 0).toLocaleString()} color="text-emerald-700" bg="bg-emerald-50" />
        <Tile icon={TrendingUp} label="Connect Rate" value={`${t.connect_rate ?? 0}%`} color="text-amber-700" bg="bg-amber-50" />
        <Tile icon={Star} label="Interested" value={(t.interested ?? 0).toLocaleString()} color="text-fuchsia-700" bg="bg-fuchsia-50" />
      </div>

      {/* Daily combined calls */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-2 mb-4 text-gray-900">
          <CalendarDays size={18} className="text-[#164FA3]" />
          <h2 className="font-bold">Calls per day (all callers combined)</h2>
        </div>
        {loading ? (
          <div className="text-gray-400 text-sm flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : (data.daily || []).length === 0 ? (
          <div className="text-gray-400 text-sm">No calls in this period.</div>
        ) : (
          <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-2">
            {data.daily.map((d) => (
              <div key={d.day} className="flex items-center gap-3 text-sm">
                <div className="w-24 shrink-0 text-gray-600 font-medium">{fmtDay(d.day)}</div>
                <div className="flex-1 bg-gray-100 rounded-full h-6 relative overflow-hidden">
                  <div className="bg-[#164FA3] h-full rounded-full flex items-center justify-end px-2" style={{ width: `${Math.max(6, (d.total_calls / maxDay) * 100)}%` }}>
                    <span className="text-[11px] font-bold text-white">{d.total_calls}</span>
                  </div>
                </div>
                <div className="w-40 shrink-0 text-xs text-gray-500 text-right">
                  {d.connected} connected · {d.active_callers} caller{d.active_callers === 1 ? "" : "s"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ranked caller table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center gap-2">
          <TrendingUp size={18} className="text-[#164FA3]" />
          <h2 className="font-bold text-gray-900">Caller-wise ranking</h2>
        </div>
        {loading ? (
          <div className="p-8 text-gray-400">Loading…</div>
        ) : data.callers.length === 0 ? (
          <div className="p-8 text-gray-400">No callers found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <Th>#</Th>
                  <Th>Caller</Th>
                  <Th right>Total Calls</Th>
                  <Th right>Connected</Th>
                  <Th right>Connect %</Th>
                  <Th right>Not Picked</Th>
                  <Th right>Wrong #</Th>
                  <Th right>Rude</Th>
                  <Th right>Reached</Th>
                  <Th right>Avg Dur</Th>
                  <Th right>Talk Time</Th>
                  <Th right>Follow-ups</Th>
                  <Th right>Interested</Th>
                  <Th right>Active Days</Th>
                  <Th right>Last Call</Th>
                </tr>
              </thead>
              <tbody>
                {data.callers.map((c) => (
                  <tr key={c.user_id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3"><RankBadge rank={c.rank} /></td>
                    <td className="px-4 py-3 font-semibold text-gray-900">{c.name}</td>
                    <td className="px-4 py-3 text-right font-medium">{c.total_calls.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-700">{c.connected.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right"><RateChip rate={c.connect_rate} /></td>
                    <td className="px-4 py-3 text-right text-gray-500">{c.not_picked}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{c.wrong_number}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{c.rude}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{c.unique_reached}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{fmtDur(c.avg_duration_seconds)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{fmtDur(c.total_talk_seconds)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{c.follow_ups}</td>
                    <td className="px-4 py-3 text-right text-fuchsia-700 font-medium">{c.interested}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{c.active_days}</td>
                    <td className="px-4 py-3 text-right text-gray-500 text-xs">{c.last_call_at ? fmtDateTime(c.last_call_at) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ icon: Icon, label, value, color, bg }) {
  return (
    <div className={`${bg} rounded-2xl p-4 border border-gray-100`}>
      <div className={`flex items-center gap-2 ${color} mb-1`}><Icon size={16} /><span className="text-xs uppercase tracking-wide font-semibold">{label}</span></div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}
function Th({ children, right }) {
  return <th className={`px-4 py-3 font-semibold ${right ? "text-right" : "text-left"}`}>{children}</th>;
}
function RankBadge({ rank }) {
  const medal = rank === 1 ? "bg-[#FCB712] text-[#164FA3]" : rank === 2 ? "bg-gray-300 text-gray-800" : rank === 3 ? "bg-amber-700 text-white" : "bg-gray-100 text-gray-500";
  return <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${medal}`}>{rank}</span>;
}
function RateChip({ rate }) {
  const cls = rate >= 50 ? "bg-emerald-100 text-emerald-700" : rate >= 25 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500";
  return <span className={`text-xs font-bold px-2 py-1 rounded-lg ${cls}`}>{rate}%</span>;
}

function fmtDur(s) {
  s = Number(s) || 0;
  if (s <= 0) return "—";
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
function fmtDay(d) {
  const dt = new Date(d);
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
function fmtDateTime(d) {
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
