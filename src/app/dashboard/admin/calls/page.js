"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, Filter, RefreshCcw, Phone, MapPin, ChevronRight, Loader2, Download } from "lucide-react";
import { isAdmin, normalizeRole, ROLES } from "@/lib/permissions";

const STATUS_PILL = {
  "Phone Picked":   { bg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  "Not Picked":     { bg: "bg-amber-50 text-amber-700 border-amber-200" },
  "Wrong Number":   { bg: "bg-gray-100 text-gray-600 border-gray-200" },
  "Rudely Behaved": { bg: "bg-red-50 text-red-700 border-red-200" },
  "Busy":           { bg: "bg-purple-50 text-purple-700 border-purple-200" },
  "Switched Off":   { bg: "bg-sky-50 text-sky-700 border-sky-200" },
};
const SENTIMENT_PILL = {
  positive:  { bg: "bg-emerald-100 text-emerald-700", label: "Positive" },
  supporter: { bg: "bg-emerald-200 text-emerald-800", label: "Supporter" },
  neutral:   { bg: "bg-gray-100 text-gray-600", label: "Neutral" },
  negative:  { bg: "bg-orange-100 text-orange-700", label: "Negative" },
  opponent:  { bg: "bg-red-100 text-red-700", label: "Opponent" },
};

function fmtDur(seconds) {
  if (!seconds && seconds !== 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AdminCallRecords() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [districtFilter, setDistrictFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Master data
  const [statuses, setStatuses] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [users, setUsers] = useState([]);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && !isAdmin(session)) router.push("/dashboard");
  }, [status, session, router]);

  useEffect(() => {
    if (status !== "authenticated" || !isAdmin(session)) return;
    (async () => {
      const [s, d, u] = await Promise.all([
        fetch("/api/statuses").then((r) => r.json()).catch(() => ({})),
        fetch("/api/locations?type=district").then((r) => r.json()).catch(() => ({})),
        fetch("/api/users").then((r) => r.json()).catch(() => ({})),
      ]);
      setStatuses(s.statuses || []);
      setDistricts(d.locations || []);
      setUsers((u.users || []).filter((x) => normalizeRole(x.role) === ROLES.CALLER));
    })();
  }, [status, session]);

  const fetchCalls = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status_id", statusFilter);
    if (districtFilter) params.set("district_id", districtFilter);
    if (agentFilter) params.set("user_id", agentFilter);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    try {
      const r = await fetch(`/api/calls?${params}`);
      if (r.ok) setCalls((await r.json()).calls || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status === "authenticated" && isAdmin(session)) fetchCalls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session]);

  // Re-fetch on filter changes (debounced for search)
  useEffect(() => {
    if (status !== "authenticated" || !isAdmin(session)) return;
    const t = setTimeout(fetchCalls, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, districtFilter, agentFilter, dateFrom, dateTo]);

  const resetFilters = () => {
    setSearch(""); setStatusFilter(""); setDistrictFilter("");
    setAgentFilter(""); setDateFrom(""); setDateTo("");
  };

  const summary = useMemo(() => {
    const total = calls.length;
    const connected = calls.filter((c) => c.status_name === "Phone Picked").length;
    const noAnswer = calls.filter((c) => c.status_name === "Not Picked").length;
    const followUps = calls.filter((c) => c.is_follow_up_required).length;
    const avgDur = (() => {
      const withDur = calls.filter((c) => c.duration_seconds);
      if (withDur.length === 0) return null;
      return Math.round(withDur.reduce((a, c) => a + c.duration_seconds, 0) / withDur.length);
    })();
    return { total, connected, noAnswer, followUps, avgDur };
  }, [calls]);

  if (status !== "authenticated" || !isAdmin(session)) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Call Records</h1>
          <p className="text-gray-500 mt-2 font-medium">Detailed log of every call logged across the team.</p>
        </div>
        <div className="flex gap-2">
          <a href="/api/supervisor/export/summary" className="inline-flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium shadow-sm">
            <Download size={16} /> Export PDF
          </a>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <SumCard label="Matching" value={summary.total} accent />
        <SumCard label="Connected" value={summary.connected} />
        <SumCard label="No Answer" value={summary.noAnswer} />
        <SumCard label="Follow-ups" value={summary.followUps} />
        <SumCard label="Avg duration" value={summary.avgDur != null ? fmtDur(summary.avgDur) : "—"} />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <Label>Search (name / phone)</Label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type to search…" className="w-full pl-9 h-10 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
            </div>
          </div>
          <div>
            <Label>Date from</Label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
          </div>
          <div>
            <Label>Date to</Label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
          </div>
          <div>
            <Label>Status</Label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]">
              <option value="">All statuses</option>
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <Label>District</Label>
            <select value={districtFilter} onChange={(e) => setDistrictFilter(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]">
              <option value="">All districts</option>
              {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Agent</Label>
            <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]">
              <option value="">All agents</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
            </select>
          </div>
          <div className="lg:col-span-2 flex items-end gap-2">
            <button onClick={resetFilters} className="h-10 px-4 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2">
              <RefreshCcw size={14} /> Reset
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">When</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Person</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Phone</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Agent</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Location</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Sentiment</th>
                <th className="px-4 py-3 font-semibold text-gray-600 text-right">Duration</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Remarks</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="10" className="py-12 text-center text-gray-400"><Loader2 className="inline animate-spin text-[#164FA3]" /></td></tr>
              ) : calls.length === 0 ? (
                <tr><td colSpan="10" className="py-12 text-center text-gray-400">No calls match the current filters.</td></tr>
              ) : (
                calls.map((c) => {
                  const statusStyle = STATUS_PILL[c.status_name] || STATUS_PILL["Wrong Number"];
                  const sentStyle = c.sentiment ? SENTIMENT_PILL[c.sentiment] : null;
                  return (
                    <tr key={c.id} className="border-t border-gray-100 hover:bg-blue-50/30 align-top">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {new Date(c.called_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {c.person_name}
                        {c.is_vip ? <span className="ml-2 text-[10px] uppercase font-bold text-[#FCB712]">VIP</span> : null}
                      </td>
                      <td className="px-4 py-3 text-gray-700 font-mono text-xs">{c.phone_number}</td>
                      <td className="px-4 py-3 text-gray-600">{c.agent_name || "—"}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {[c.district_name, c.assembly_name].filter(Boolean).join(" / ") || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block text-[11px] font-semibold px-2 py-1 rounded-full border ${statusStyle.bg}`}>
                          {c.status_name || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {sentStyle ? (
                          <span className={`inline-block text-[11px] font-semibold px-2 py-1 rounded-full ${sentStyle.bg}`}>
                            {sentStyle.label}
                          </span>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700 font-mono text-xs">{fmtDur(c.duration_seconds)}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-xs">
                        <div className="line-clamp-2">{c.remarks || <span className="text-gray-300">—</span>}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/admin/calls/${c.id}`} className="text-[#164FA3] hover:underline text-xs font-semibold inline-flex items-center">
                          View <ChevronRight size={14} />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {!loading && calls.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-500 bg-gray-50">
            Showing <strong>{calls.length}</strong> call{calls.length === 1 ? "" : "s"}.
            {calls.length >= 1000 && <span className="ml-2 text-amber-600 font-semibold">(Result capped at 1000 — narrow filters to see more.)</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function Label({ children }) {
  return <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">{children}</label>;
}

function SumCard({ label, value, accent }) {
  return (
    <div className={`${accent ? "bg-[#164FA3] text-white" : "bg-white border border-gray-100"} rounded-xl p-4 shadow-sm`}>
      <div className={`text-2xl font-bold ${accent ? "" : "text-gray-900"}`}>{value}</div>
      <div className={`text-xs font-medium mt-1 ${accent ? "text-blue-200" : "text-gray-500"}`}>{label}</div>
    </div>
  );
}
