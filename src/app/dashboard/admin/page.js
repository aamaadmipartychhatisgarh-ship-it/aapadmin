"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  PhoneCall, PhoneOff, PhoneForwarded, AlertTriangle, Users as UsersIcon,
  TrendingUp, TrendingDown, Activity, Upload, UserPlus, Download, ListChecks,
  ArrowRight, Loader2,
} from "lucide-react";
import { isAdmin, normalizeRole, ROLES } from "@/lib/permissions";

const RANGES = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "Last 7 days" },
];

export default function AdminDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [range, setRange] = useState("today");
  const [data, setData] = useState(null);
  const [scope, setScope] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && !isAdmin(session)) router.push("/dashboard");
  }, [status, session, router]);

  // Load the role + territory label once.
  useEffect(() => {
    if (status !== "authenticated" || !isAdmin(session)) return;
    fetch("/api/me/scope").then((r) => r.json()).then(setScope).catch(() => {});
  }, [status, session]);

  useEffect(() => {
    if (status !== "authenticated" || !isAdmin(session)) return;
    let cancelled = false;
    const load = async () => {
      const r = await fetch(`/api/admin/overview?range=${range}`);
      if (r.ok && !cancelled) setData(await r.json());
      setLoading(false);
    };
    load();
    // Only poll while the tab is visible — background tabs polling every 30s
    // pile server-side load (and processes) for no one who's looking.
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [status, session, range]);

  if (status !== "authenticated" || !isAdmin(session)) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  if (loading || !data) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  const { tally, funnel, live, districts, timeline } = data;
  const delta = (a, b) => (b === 0 ? null : Math.round(((a - b) / b) * 100));

  // Personalized title based on the admin's scope.
  const titleByLevel = {
    state:    "State Overview",
    zone:     `Zone Overview · ${scope?.name || ""}`,
    district: `District Overview · ${scope?.name || ""}`,
    assembly: `Assembly Overview · ${scope?.name || ""}`,
  };
  const title = scope ? (titleByLevel[scope.level] || "Overview") : "Overview";

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">{title}</h1>
          <p className="text-gray-500 mt-2 font-medium">
            {scope?.roleLabel || "Admin"} · operations summary · auto-refreshes every 30s
          </p>
        </div>
        {/* Supervisor View link only shown to top-tier admins who oversee state-wide calling ops */}
        {[ROLES.SUPER_ADMIN, ROLES.STATE_ADMIN].includes(normalizeRole(session.user.role)) && (
          <div className="flex gap-2">
            <Link href="/dashboard/supervisor" className="inline-flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium shadow-sm">
              Supervisor View <ArrowRight size={16} />
            </Link>
          </div>
        )}
      </div>

      {/* Live strip */}
      <div className="bg-[#164FA3] text-white rounded-2xl p-4 shadow-sm flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-400"></span>
          </span>
          <span className="font-bold">{live.online}</span>
          <span className="text-blue-200 text-sm">callers online</span>
        </div>
        <Sep />
        <LiveStat label="calls in last hour" value={live.last_hour} />
        <Sep />
        <LiveStat label="contacts in pool" value={live.pool_available} />
        <Sep />
        <LiveStat label="overdue follow-ups" value={live.overdue_follow_ups} highlight={live.overdue_follow_ups > 0} />
      </div>

      {/* Range toggle */}
      <div className="flex gap-2">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`px-4 py-2 rounded-xl text-sm font-medium ${range === r.key ? "bg-[#164FA3] text-white" : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"}`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* KPI cards with deltas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <KpiCard label="Total Calls" value={tally.cur.total} delta={delta(tally.cur.total, tally.prev.total)} icon={PhoneCall} accent />
        <KpiCard label="Connected" value={tally.cur.connected} delta={delta(tally.cur.connected, tally.prev.connected)} icon={PhoneForwarded} />
        <KpiCard label="Not Picked" value={tally.cur.no_answer} delta={delta(tally.cur.no_answer, tally.prev.no_answer)} icon={PhoneOff} inverted />
        <KpiCard label="Wrong Number" value={tally.cur.wrong_number} delta={delta(tally.cur.wrong_number, tally.prev.wrong_number)} icon={AlertTriangle} inverted />
      </div>

      {/* Funnel + chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 lg:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-bold text-lg text-gray-900">Calls Over Time</h2>
            <span className="text-xs text-gray-400 font-medium">Last 7 days</span>
          </div>
          <div className="h-[260px]">
            {timeline.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-400">No calls yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeline.map((t) => ({ day: new Date(t.day).toLocaleDateString("en-GB", { weekday: "short" }), calls: Number(t.n) }))}>
                  <CartesianGrid stroke="#eee" strokeDasharray="5 5" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: "#6B7280", fontSize: 12 }} />
                  <YAxis tick={{ fill: "#6B7280", fontSize: 12 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="calls" stroke="#164FA3" strokeWidth={3} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Contact funnel */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-5">
            <ListChecks size={18} className="text-[#164FA3]" />
            <h2 className="font-bold text-lg text-gray-900">Contact Funnel</h2>
          </div>
          <FunnelRow label="Loaded" value={funnel.total_contacts} base={funnel.total_contacts} color="bg-[#164FA3]" />
          <FunnelRow label="Assigned" value={funnel.assigned} base={funnel.total_contacts} color="bg-blue-500" />
          <FunnelRow label="Attempted" value={funnel.attempted} base={funnel.total_contacts} color="bg-amber-500" />
          <FunnelRow label="Completed" value={funnel.completed} base={funnel.total_contacts} color="bg-emerald-500" />
          <Link href="/dashboard/admin/contacts" className="mt-4 text-sm text-[#164FA3] hover:underline inline-flex items-center gap-1 font-medium">
            Manage contacts <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      {/* Quick actions + districts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h2 className="font-bold text-lg text-gray-900 mb-4">Quick Actions</h2>
          <div className="space-y-2">
            <QuickAction href="/dashboard/admin/contacts" icon={Upload} label="Upload contacts CSV" />
            <QuickAction href="/dashboard/admin/users" icon={UserPlus} label="Add a user" />
            <QuickAction href="/dashboard/admin/contacts" icon={ListChecks} label="Assign pool contacts" />
            <QuickAction href="/api/supervisor/export/summary" icon={Download} label="Export daily summary (PDF)" external />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-lg text-gray-900">Top Districts</h2>
            <span className="text-xs text-gray-400 font-medium">By contact volume</span>
          </div>
          {districts.length === 0 ? (
            <p className="text-gray-400 text-sm">No contacts loaded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="pb-2 font-semibold">District</th>
                  <th className="pb-2 font-semibold text-right">Contacts</th>
                  <th className="pb-2 font-semibold text-right">Completed</th>
                  <th className="pb-2 font-semibold text-right">Progress</th>
                </tr>
              </thead>
              <tbody>
                {districts.map((d) => {
                  const pct = d.contacts > 0 ? Math.round((d.completed / d.contacts) * 100) : 0;
                  return (
                    <tr key={d.id} className="border-t border-gray-100">
                      <td className="py-2 font-medium text-gray-900">{d.name}</td>
                      <td className="py-2 text-right text-gray-700">{d.contacts}</td>
                      <td className="py-2 text-right text-emerald-700 font-medium">{d.completed}</td>
                      <td className="py-2 text-right">
                        <div className="inline-flex items-center gap-2">
                          <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }}></div>
                          </div>
                          <span className="font-bold text-xs text-gray-700 w-8 text-right">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Sep() {
  return <span className="w-px h-6 bg-white/20 hidden sm:inline-block"></span>;
}

function LiveStat({ label, value, highlight }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`font-bold text-xl ${highlight ? "text-[#FCB712]" : "text-white"}`}>{value}</span>
      <span className="text-blue-200 text-sm">{label}</span>
    </div>
  );
}

function KpiCard({ label, value, delta, icon: Icon, accent, inverted }) {
  // For "Wrong Number" / "Not Picked", going UP is bad — flip the delta color.
  const goodColor = "text-emerald-600";
  const badColor = "text-red-600";
  const deltaColor = delta == null
    ? "text-gray-400"
    : inverted
      ? (delta > 0 ? badColor : delta < 0 ? goodColor : "text-gray-400")
      : (delta > 0 ? goodColor : delta < 0 ? badColor : "text-gray-400");
  const Arrow = delta == null ? null : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : null;

  return (
    <div className={`${accent ? "bg-[#164FA3] text-white" : "bg-white"} rounded-2xl p-6 shadow-sm border border-gray-100 flex flex-col gap-4`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${accent ? "bg-white/20 text-white" : "bg-gray-100 text-[#164FA3]"}`}>
        <Icon size={20} />
      </div>
      <div>
        <h3 className={`text-3xl font-bold tracking-tighter ${accent ? "text-white" : "text-gray-900"}`}>{value}</h3>
        <p className={`text-sm font-medium mt-1 ${accent ? "text-blue-200" : "text-gray-500"}`}>{label}</p>
        {delta != null && (
          <div className={`flex items-center gap-1 text-xs font-bold mt-2 ${accent ? "text-blue-100" : deltaColor}`}>
            {Arrow && <Arrow size={12} />}
            <span>{delta > 0 ? "+" : ""}{delta}% vs prev</span>
          </div>
        )}
      </div>
    </div>
  );
}

function FunnelRow({ label, value, base, color }) {
  const pct = base > 0 ? Math.round((value / base) * 100) : 0;
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between text-sm mb-1">
        <span className="font-medium text-gray-700">{label}</span>
        <span className="font-bold text-gray-900">{value} <span className="text-gray-400 font-normal text-xs">({pct}%)</span></span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }}></div>
      </div>
    </div>
  );
}

function QuickAction({ href, icon: Icon, label, external }) {
  const Cmp = external ? "a" : Link;
  return (
    <Cmp href={href} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-blue-50 border border-gray-100 group">
      <div className="w-8 h-8 rounded-lg bg-blue-50 text-[#164FA3] flex items-center justify-center group-hover:bg-[#164FA3] group-hover:text-white transition-colors">
        <Icon size={16} />
      </div>
      <span className="text-sm font-medium text-gray-700 group-hover:text-[#164FA3] flex-1">{label}</span>
      <ArrowRight size={14} className="text-gray-300 group-hover:text-[#164FA3]" />
    </Cmp>
  );
}
