"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Users, UserCheck, UserX, UserPlus, Gauge, Award, Search, Filter, Download, X,
  Loader2, Shield, ChevronLeft, ChevronRight, Eye, TrendingUp, MapPin, Phone,
  Star, RefreshCw, Calendar, AlertCircle, ArrowUpDown, CheckCircle2, XCircle, Clock,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
} from "recharts";
import { normalizeRole, ROLES } from "@/lib/permissions";

const BRAND = "#164FA3";
const PERIODS = [
  { v: "", l: "Lifetime / Campaign Total" },
  { v: "today", l: "Today" },
  { v: "yesterday", l: "Yesterday" },
  { v: "week", l: "This Week" },
  { v: "month", l: "This Month" },
  { v: "custom", l: "Custom Range" },
];
const TABS = [
  { k: "overview", l: "Overview" },
  { k: "workers", l: "Workers" },
  { k: "members", l: "Members" },
  { k: "ranking", l: "Top 200" },
  { k: "zero", l: "Zero Members" },
  { k: "geo", l: "Assembly / Block" },
  { k: "campaign", l: "Campaign" },
];

function api(path, params) {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== "") p.set(k, v); });
  const qs = p.toString();
  return fetch(`/api/worker-membership/${path}${qs ? `?${qs}` : ""}`, { cache: "no-store" });
}
function download(path, params) {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== "") p.set(k, v); });
  const a = document.createElement("a");
  a.href = `/api/worker-membership/${path}?${p.toString()}`;
  a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}
const fmtDate = (v) => (v ? String(v).slice(0, 10) : "—");
const fmtDateTime = (v) => (v ? String(v).slice(0, 19).replace("T", " ") : "—");

export default function WorkerMembershipPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const isSuper = normalizeRole(session?.user?.role) === ROLES.SUPER_ADMIN;

  const [tab, setTab] = useState("overview");
  // Shared filters
  const [period, setPeriod] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [assembly, setAssembly] = useState("");
  const [ward, setWard] = useState("");
  const [booth, setBooth] = useState("");
  // Location option lists (cascading)
  const [assemblies, setAssemblies] = useState([]);
  const [wards, setWards] = useState([]);
  const [booths, setBooths] = useState([]);

  const filters = useMemo(() => ({
    period, from: period === "custom" ? from : "", to: period === "custom" ? to : "",
    assembly_id: assembly, ward_id: ward, booth_id: booth,
  }), [period, from, to, assembly, ward, booth]);

  useEffect(() => {
    if (!isSuper) return;
    fetch("/api/locations?type=assembly", { cache: "no-store" })
      .then((r) => r.json()).then((d) => setAssemblies(d.locations || [])).catch(() => {});
  }, [isSuper]);
  useEffect(() => {
    setWard(""); setBooth(""); setBooths([]);
    if (!assembly) { setWards([]); return; }
    fetch(`/api/locations?type=ward&parent_id=${assembly}`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => setWards(d.locations || [])).catch(() => setWards([]));
  }, [assembly]);
  useEffect(() => {
    setBooth("");
    if (!ward) { setBooths([]); return; }
    fetch(`/api/locations?type=booth&parent_id=${ward}`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => setBooths(d.locations || [])).catch(() => setBooths([]));
  }, [ward]);

  if (authStatus === "loading") {
    return <div className="flex items-center justify-center py-24"><Loader2 className="animate-spin" style={{ color: BRAND }} size={28} /></div>;
  }
  if (!isSuper) {
    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center">
        <div className="max-w-md w-full bg-white border border-gray-200 rounded-2xl shadow-sm p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4"><Shield size={26} /></div>
          <h2 className="text-lg font-bold text-gray-900">Access Denied</h2>
          <p className="text-sm text-gray-500 mt-2">Worker &amp; Membership Management is restricted to the Super Admin.</p>
          <button onClick={() => router.push("/dashboard")} className="mt-6 h-10 px-5 rounded-lg text-white text-sm font-semibold" style={{ background: BRAND }}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1500px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white" style={{ background: BRAND }}><Users size={22} /></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Worker &amp; Membership Management</h1>
            <p className="text-sm text-gray-500">Super Admin only · live database</p>
          </div>
        </div>
      </div>

      {/* Shared filter bar */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4">
        <div className="flex flex-wrap items-end gap-2">
          <FilterSelect label="Period" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p.v, label: p.l }))} />
          {period === "custom" && (
            <>
              <div><label className="block text-[11px] font-medium text-gray-500 mb-1">From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={ctrl} /></div>
              <div><label className="block text-[11px] font-medium text-gray-500 mb-1">To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={ctrl} /></div>
            </>
          )}
          <FilterSelect label="Assembly" value={assembly} onChange={setAssembly} options={[{ value: "", label: "All assemblies" }, ...assemblies.map((a) => ({ value: String(a.id), label: a.name }))]} />
          <FilterSelect label="Block / Ward" value={ward} onChange={setWard} disabled={!assembly} options={[{ value: "", label: assembly ? "All blocks" : "Select assembly" }, ...wards.map((w) => ({ value: String(w.id), label: w.name }))]} />
          <FilterSelect label="Booth" value={booth} onChange={setBooth} disabled={!ward} options={[{ value: "", label: ward ? "All booths" : "Select block" }, ...booths.map((b) => ({ value: String(b.id), label: b.name }))]} />
          {(period || assembly || ward || booth) && (
            <button onClick={() => { setPeriod(""); setFrom(""); setTo(""); setAssembly(""); setWard(""); setBooth(""); }} className="h-9 px-3 rounded-lg border border-gray-200 text-xs font-medium text-gray-500 hover:bg-gray-50 inline-flex items-center gap-1"><X size={13} /> Clear</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 mb-4 border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.k ? "border-[#164FA3] text-[#164FA3]" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {t.l}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab filters={filters} />}
      {tab === "workers" && <WorkersTab filters={filters} mode="all" />}
      {tab === "members" && <MembersTab filters={filters} />}
      {tab === "ranking" && <RankingTab filters={filters} />}
      {tab === "zero" && <WorkersTab filters={filters} mode="zero" />}
      {tab === "geo" && <GeoTab filters={filters} assemblies={assemblies} />}
      {tab === "campaign" && <CampaignTab />}
    </div>
  );
}

// ---------------------------------------------------------------- OVERVIEW
function OverviewTab({ filters }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [bucket, setBucket] = useState("day");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await api("summary", { ...filters, bucket });
      if (r.status === 403) { setErr("Access denied."); return; }
      if (!r.ok) throw new Error();
      setData(await r.json());
    } catch { setErr("Could not load the dashboard. Please retry."); }
    finally { setLoading(false); }
  }, [filters, bucket]);
  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <Loading />;
  if (err) return <ErrorState msg={err} onRetry={load} />;
  if (!data) return null;
  const s = data.summary;
  const periodLabel = filters.period ? "Selected period" : "Lifetime";

  return (
    <div className="space-y-4">
      {/* Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card icon={Users} label="Total Workers" value={s.totalWorkers} tint="#164FA3" />
        <Card icon={UserPlus} label={`Members (${periodLabel})`} value={s.periodMembers} sub={`Lifetime: ${s.lifetimeMembers}`} tint="#0F9D58" />
        <Card icon={UserCheck} label="Active Workers" value={s.activeWorkers} tint="#1A73E8" />
        <Card icon={CheckCircle2} label="Workers With Members" value={s.workersWithMembers} tint="#7E57C2" />
        <Card icon={UserX} label="Workers With 0" value={s.workersWithZero} tint="#E5533C" />
        <Card icon={Gauge} label="Avg Members / Worker" value={s.avgMembersPerWorker} tint="#F09300" />
      </div>

      {/* Growth + assembly charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Membership Growth" right={
          <div className="flex gap-1">
            {["day", "week", "month"].map((b) => (
              <button key={b} onClick={() => setBucket(b)} className={`px-2 py-0.5 rounded text-xs font-medium ${bucket === b ? "bg-[#164FA3] text-white" : "bg-gray-100 text-gray-600"}`}>{b[0].toUpperCase() + b.slice(1)}</button>
            ))}
          </div>
        }>
          {data.growth.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data.growth}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} minTickGap={20} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="members" name="Added" stroke="#0F9D58" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="cumulative" name="Cumulative" stroke="#164FA3" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Assembly-wise Membership (Top 10)">
          {data.assemblies.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.assemblies.slice(0, 10)} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                <Tooltip />
                <Bar dataKey="total_members" name="Members" fill="#164FA3" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      {/* Ranking + campaign */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title="Top Workers" className="lg:col-span-2">
          {data.ranking.length === 0 ? <EmptyState msg="No members registered yet." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-400 text-xs uppercase"><th className="py-1.5 pr-2">#</th><th className="py-1.5 pr-2">Worker</th><th className="py-1.5 pr-2">Assembly</th><th className="py-1.5 pr-2 text-right">Members</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {data.ranking.slice(0, 10).map((w) => (
                    <tr key={w.id}><td className="py-1.5 pr-2 font-semibold text-gray-500">{w.rank}</td><td className="py-1.5 pr-2 font-medium text-gray-900">{w.name} <span className="text-xs text-gray-400">{w.worker_code}</span></td><td className="py-1.5 pr-2 text-gray-600">{w.assembly_name || "—"}</td><td className="py-1.5 pr-2 text-right font-semibold" style={{ color: BRAND }}>{w.member_count}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Current Campaign">
          <CampaignSummary campaign={data.campaign} />
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- WORKERS
function WorkersTab({ filters, mode }) {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [wStatus, setWStatus] = useState("");
  const [membership, setMembership] = useState(mode === "zero" ? "zero" : "");
  const [sort, setSort] = useState("members");
  const [dir, setDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState(null);

  useEffect(() => { const t = setTimeout(() => { setDebounced(search); setPage(1); }, 350); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); }, [filters, wStatus, membership, sort, dir]);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await api("workers", {
        ...filters, search: debounced, worker_status: wStatus,
        membership: mode === "zero" ? "zero" : membership, sort, dir, page, pageSize: 20,
      });
      if (r.status === 403) { setErr("Access denied."); return; }
      if (!r.ok) throw new Error();
      const d = await r.json();
      setRows(d.workers || []); setMeta({ total: d.total, page: d.page, pages: d.pages });
    } catch { setErr("Could not load workers."); }
    finally { setLoading(false); }
  }, [filters, debounced, wStatus, membership, sort, dir, page, mode]);
  useEffect(() => { load(); }, [load]);

  const toggleSort = (col) => { if (sort === col) setDir(dir === "asc" ? "desc" : "asc"); else { setSort(col); setDir(col === "name" || col === "assembly" ? "asc" : "desc"); } };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, User ID, mobile…" className="w-full pl-9 pr-3 h-9 rounded-lg border border-gray-200 text-sm" />
        </div>
        <select value={wStatus} onChange={(e) => setWStatus(e.target.value)} className={ctrl}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="pending">Pending</option></select>
        {mode !== "zero" && (
          <select value={membership} onChange={(e) => setMembership(e.target.value)} className={ctrl}><option value="">With & without members</option><option value="with">With members</option><option value="zero">Zero members</option></select>
        )}
        <button onClick={() => download("export", { type: "workers", ...filters, search: debounced, worker_status: wStatus, membership: mode === "zero" ? "zero" : membership, sort, dir })} className="h-9 px-3 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5"><Download size={15} /> Export</button>
      </div>

      {err ? <ErrorState msg={err} onRetry={load} /> : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wide">
                <Th onClick={() => toggleSort("rank")} active={sort === "rank"} dir={dir}>Rank</Th>
                <Th onClick={() => toggleSort("name")} active={sort === "name"} dir={dir}>Worker</Th>
                <th className="px-3 py-2.5 font-semibold">User ID</th>
                <th className="px-3 py-2.5 font-semibold">Mobile</th>
                <Th onClick={() => toggleSort("assembly")} active={sort === "assembly"} dir={dir}>Assembly</Th>
                <th className="px-3 py-2.5 font-semibold">Block</th>
                <Th onClick={() => toggleSort("members")} active={sort === "members"} dir={dir} className="text-right">Members</Th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <Th onClick={() => toggleSort("last_activity")} active={sort === "last_activity"} dir={dir}>Last Added</Th>
                <th className="px-3 py-2.5 font-semibold text-right">View</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? <tr><td colSpan={10} className="py-14 text-center text-gray-400"><Loader2 className="animate-spin inline" size={20} /></td></tr>
                  : rows.length === 0 ? <tr><td colSpan={10} className="py-14 text-center text-gray-400">No workers match the current filters.</td></tr>
                  : rows.map((w) => (
                    <tr key={w.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setDetailId(w.id)}>
                      <td className="px-3 py-2.5 font-semibold text-gray-500">{w.rank}</td>
                      <td className="px-3 py-2.5 font-medium text-gray-900">{w.name}</td>
                      <td className="px-3 py-2.5 text-gray-600 font-mono text-xs">{w.worker_code || "—"}</td>
                      <td className="px-3 py-2.5 text-gray-600">{w.mobile || "—"}</td>
                      <td className="px-3 py-2.5 text-gray-600">{w.assembly_name || "—"}</td>
                      <td className="px-3 py-2.5 text-gray-600">{w.ward_name || "—"}</td>
                      <td className="px-3 py-2.5 text-right font-semibold" style={{ color: BRAND }}>{w.member_count}</td>
                      <td className="px-3 py-2.5"><StatusPill status={w.worker_status} /></td>
                      <td className="px-3 py-2.5 text-gray-500 text-xs">{w.last_member_at ? fmtDate(w.last_member_at) : "—"}</td>
                      <td className="px-3 py-2.5 text-right"><Eye size={16} className="inline text-gray-400" /></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <Pager meta={meta} onPage={setPage} />
        </div>
      )}
      {detailId && <WorkerDetailModal id={detailId} onClose={() => setDetailId(null)} onOpenMember={(mid) => { setDetailId(null); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- MEMBERS
function MembersTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [cert, setCert] = useState("");
  const [wa, setWa] = useState("");
  const [sms, setSms] = useState("");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState(null);

  useEffect(() => { const t = setTimeout(() => { setDebounced(search); setPage(1); }, 350); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); }, [filters, cert, wa, sms]);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await api("members", { ...filters, search: debounced, certificate: cert, whatsapp: wa, sms, page, pageSize: 20 });
      if (r.status === 403) { setErr("Access denied."); return; }
      if (!r.ok) throw new Error();
      const d = await r.json();
      setRows(d.members || []); setMeta({ total: d.total, page: d.page, pages: d.pages });
    } catch { setErr("Could not load members."); }
    finally { setLoading(false); }
  }, [filters, debounced, cert, wa, sms, page]);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search member, mobile, ID, worker…" className="w-full pl-9 pr-3 h-9 rounded-lg border border-gray-200 text-sm" />
        </div>
        <select value={cert} onChange={(e) => setCert(e.target.value)} className={ctrl}><option value="">Certificate: all</option><option value="pending">Pending</option><option value="generated">Generated</option><option value="failed">Failed</option></select>
        <select value={wa} onChange={(e) => setWa(e.target.value)} className={ctrl}><option value="">WhatsApp: all</option><option value="pending">Pending</option><option value="sent">Sent</option><option value="failed">Failed</option></select>
        <select value={sms} onChange={(e) => setSms(e.target.value)} className={ctrl}><option value="">SMS: all</option><option value="pending">Pending</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="not_required">Not required</option></select>
        <button onClick={() => download("export", { type: "members", ...filters, search: debounced, certificate: cert, whatsapp: wa, sms })} className="h-9 px-3 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5"><Download size={15} /> Export</button>
      </div>

      {err ? <ErrorState msg={err} onRetry={load} /> : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wide">
                <th className="px-3 py-2.5 font-semibold">Member</th><th className="px-3 py-2.5 font-semibold">Membership ID</th><th className="px-3 py-2.5 font-semibold">Mobile</th><th className="px-3 py-2.5 font-semibold">Assembly</th><th className="px-3 py-2.5 font-semibold">Added By</th><th className="px-3 py-2.5 font-semibold">Registered</th><th className="px-3 py-2.5 font-semibold">Cert</th><th className="px-3 py-2.5 font-semibold">WA</th><th className="px-3 py-2.5 font-semibold">SMS</th><th className="px-3 py-2.5 font-semibold text-right">View</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? <tr><td colSpan={10} className="py-14 text-center text-gray-400"><Loader2 className="animate-spin inline" size={20} /></td></tr>
                  : rows.length === 0 ? <tr><td colSpan={10} className="py-14 text-center text-gray-400">No members registered for the current filters yet.</td></tr>
                  : rows.map((m) => (
                    <tr key={m.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setDetailId(m.id)}>
                      <td className="px-3 py-2.5 font-medium text-gray-900">{m.name}</td>
                      <td className="px-3 py-2.5 text-gray-600 font-mono text-xs">{m.membership_id || "—"}</td>
                      <td className="px-3 py-2.5 text-gray-600">{m.mobile || "—"}</td>
                      <td className="px-3 py-2.5 text-gray-600">{m.assembly_name || "—"}</td>
                      <td className="px-3 py-2.5 text-gray-700">{m.worker_name || "—"} <span className="text-xs text-gray-400 font-mono">{m.worker_code || ""}</span></td>
                      <td className="px-3 py-2.5 text-gray-500 text-xs">{fmtDate(m.registered_at)}</td>
                      <td className="px-3 py-2.5"><CommPill status={m.certificate_status} /></td>
                      <td className="px-3 py-2.5"><CommPill status={m.whatsapp_status} /></td>
                      <td className="px-3 py-2.5"><CommPill status={m.sms_status} /></td>
                      <td className="px-3 py-2.5 text-right"><Eye size={16} className="inline text-gray-400" /></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <Pager meta={meta} onPage={setPage} />
        </div>
      )}
      {detailId && <MemberDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- RANKING
function RankingTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [topN, setTopN] = useState(10);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await api("ranking", { ...filters, limit: 200 });
      if (r.status === 403) { setErr("Access denied."); return; }
      if (!r.ok) throw new Error();
      const d = await r.json(); setRows(d.ranking || []);
    } catch { setErr("Could not load ranking."); }
    finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { load(); }, [load]);

  if (loading && rows.length === 0) return <Loading />;
  if (err) return <ErrorState msg={err} onRetry={load} />;

  return (
    <div className="space-y-4">
      <Panel title={`Top Worker Performance`} right={
        <div className="flex items-center gap-2">
          <div className="flex gap-1">{[10, 20].map((n) => <button key={n} onClick={() => setTopN(n)} className={`px-2 py-0.5 rounded text-xs font-medium ${topN === n ? "bg-[#164FA3] text-white" : "bg-gray-100 text-gray-600"}`}>Top {n}</button>)}</div>
          <button onClick={() => download("export", { type: "ranking", ...filters })} className="h-8 px-2.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1"><Download size={13} /> Export</button>
        </div>
      }>
        {rows.length === 0 ? <EmptyState msg="No members registered yet — ranking is empty." /> : (
          <ResponsiveContainer width="100%" height={Math.max(240, topN * 26)}>
            <BarChart data={rows.slice(0, topN)} layout="vertical" margin={{ left: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
              <Tooltip />
              <Bar dataKey="member_count" name="Members" fill="#164FA3" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Panel>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 text-sm font-bold text-gray-900">Full Top 200 ({rows.length})</div>
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50"><tr className="text-left text-gray-500 text-xs uppercase"><th className="px-3 py-2">Rank</th><th className="px-3 py-2">Worker</th><th className="px-3 py-2">User ID</th><th className="px-3 py-2">Assembly</th><th className="px-3 py-2">Block</th><th className="px-3 py-2 text-right">Members</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((w) => (
                <tr key={w.id} className="hover:bg-gray-50"><td className="px-3 py-2 font-semibold text-gray-500">{w.rank}</td><td className="px-3 py-2 font-medium text-gray-900">{w.name}</td><td className="px-3 py-2 font-mono text-xs text-gray-600">{w.worker_code}</td><td className="px-3 py-2 text-gray-600">{w.assembly_name || "—"}</td><td className="px-3 py-2 text-gray-600">{w.ward_name || "—"}</td><td className="px-3 py-2 text-right font-semibold" style={{ color: BRAND }}>{w.member_count}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- GEO
function GeoTab({ filters, assemblies }) {
  const [asmRows, setAsmRows] = useState([]);
  const [wardRows, setWardRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await api("summary", filters);
      if (r.status === 403) { setErr("Access denied."); return; }
      if (!r.ok) throw new Error();
      const d = await r.json(); setAsmRows(d.assemblies || []); setWardRows(d.wards || []);
    } catch { setErr("Could not load breakdown."); }
    finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { load(); }, [load]);

  if (loading && asmRows.length === 0) return <Loading />;
  if (err) return <ErrorState msg={err} onRetry={load} />;

  return (
    <div className="space-y-4">
      <GeoTable title="Assembly-wise Membership" rows={asmRows} onExport={() => download("export", { type: "assembly", ...filters })} />
      <GeoTable title="Block / Ward-wise Membership" rows={wardRows} showAssembly onExport={() => download("export", { type: "ward", ...filters })} />
    </div>
  );
}
function GeoTable({ title, rows, showAssembly, onExport }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="text-sm font-bold text-gray-900">{title}</div>
        <button onClick={onExport} className="h-8 px-2.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1"><Download size={13} /> Export</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase"><th className="px-3 py-2">Rank</th><th className="px-3 py-2">{showAssembly ? "Block/Ward" : "Assembly"}</th>{showAssembly && <th className="px-3 py-2">Assembly</th>}<th className="px-3 py-2 text-right">Workers</th><th className="px-3 py-2 text-right">Active</th><th className="px-3 py-2 text-right">Members</th><th className="px-3 py-2 text-right">With</th><th className="px-3 py-2 text-right">Zero</th><th className="px-3 py-2 text-right">Avg</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? <tr><td colSpan={9} className="py-12 text-center text-gray-400">No data.</td></tr>
              : rows.map((r) => (
                <tr key={`${r.id}`} className="hover:bg-gray-50"><td className="px-3 py-2 font-semibold text-gray-500">{r.rank}</td><td className="px-3 py-2 font-medium text-gray-900">{r.name}</td>{showAssembly && <td className="px-3 py-2 text-gray-600">{r.assembly_name || "—"}</td>}<td className="px-3 py-2 text-right text-gray-700">{r.total_workers}</td><td className="px-3 py-2 text-right text-gray-700">{r.active_workers}</td><td className="px-3 py-2 text-right font-semibold" style={{ color: BRAND }}>{r.total_members}</td><td className="px-3 py-2 text-right text-green-600">{r.workers_with_members}</td><td className="px-3 py-2 text-right text-red-500">{r.workers_with_zero}</td><td className="px-3 py-2 text-right text-gray-700">{r.avg_members}</td></tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- CAMPAIGN
function CampaignTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", start_date: "", end_date: "", password_cycle_start: "", password_cycle_expiry: "", rotate: true });
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await fetch("/api/worker-membership/campaign", { cache: "no-store" });
      if (r.status === 403) { setErr("Access denied."); return; }
      if (!r.ok) throw new Error();
      setData(await r.json());
    } catch { setErr("Could not load campaign information."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function submit(e) {
    e.preventDefault(); setSaveErr("");
    if (!form.name.trim() || !form.start_date) { setSaveErr("Name and start date are required."); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/worker-membership/campaign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setSaveErr(d.message || "Could not save."); setSaving(false); return; }
      setShowForm(false); setForm({ name: "", start_date: "", end_date: "", password_cycle_start: "", password_cycle_expiry: "", rotate: true });
      load();
    } catch { setSaveErr("Could not save."); }
    finally { setSaving(false); }
  }

  if (loading && !data) return <Loading />;
  if (err) return <ErrorState msg={err} onRetry={load} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-900">Campaign Period &amp; Password Cycle</h2>
        <button onClick={() => setShowForm((v) => !v)} className="h-9 px-4 rounded-lg text-white text-sm font-semibold inline-flex items-center gap-1.5" style={{ background: BRAND }}><RefreshCw size={15} /> New / Rotate Cycle</button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          {saveErr && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{saveErr}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Campaign Name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={ctrl2} placeholder="e.g. Campaign 1 — Jan–Mar 2026" /></div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Start Date *</label><input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className={ctrl2} /></div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1">End Date (defaults to +3 months)</label><input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className={ctrl2} /></div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Password Cycle Expiry (defaults to end date)</label><input type="date" value={form.password_cycle_expiry} onChange={(e) => setForm({ ...form, password_cycle_expiry: e.target.value })} className={ctrl2} /></div>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.rotate} onChange={(e) => setForm({ ...form, rotate: e.target.checked })} className="w-4 h-4" /> Close the current active campaign and issue a new cycle (worker User IDs stay unchanged)</label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="h-9 px-4 rounded-lg border border-gray-200 text-sm font-medium text-gray-700">Cancel</button>
            <button type="submit" disabled={saving} className="h-9 px-4 rounded-lg text-white text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60" style={{ background: BRAND }}>{saving ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Save</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title="Current Campaign" className="lg:col-span-1"><CampaignSummary campaign={data} full /></Panel>
        <Panel title="Campaign History" className="lg:col-span-2">
          {(!data?.history || data.history.length === 0) ? <EmptyState msg="No campaigns configured yet." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-400 text-xs uppercase"><th className="py-1.5 pr-2">Name</th><th className="py-1.5 pr-2">Start</th><th className="py-1.5 pr-2">End</th><th className="py-1.5 pr-2">Cycle Expiry</th><th className="py-1.5 pr-2">Status</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {data.history.map((c) => (
                    <tr key={c.id}><td className="py-1.5 pr-2 font-medium text-gray-900">{c.name}</td><td className="py-1.5 pr-2 text-gray-600">{fmtDate(c.start_date)}</td><td className="py-1.5 pr-2 text-gray-600">{fmtDate(c.end_date)}</td><td className="py-1.5 pr-2 text-gray-600">{fmtDate(c.password_cycle_expiry)}</td><td className="py-1.5 pr-2"><StatusPill status={c.status} /></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function CampaignSummary({ campaign, full }) {
  if (!campaign) return <EmptyState msg="—" />;
  if (!campaign.configured || !campaign.current) {
    return (
      <div className="text-sm text-gray-500">
        <div className="flex items-center gap-2 text-amber-600 mb-2"><AlertCircle size={16} /> No active campaign configured.</div>
        <div>Workers affected (active): <strong className="text-gray-800">{campaign.workersAffected ?? 0}</strong></div>
        {full && <p className="mt-2 text-xs">Create a campaign period to start tracking the 3-month password cycle.</p>}
      </div>
    );
  }
  const c = campaign.current;
  return (
    <div className="space-y-2 text-sm">
      <div className="font-bold text-gray-900 text-base">{c.name}</div>
      <Row k="Period" v={`${fmtDate(c.start_date)} → ${fmtDate(c.end_date)}`} />
      <Row k="Days Remaining" v={<strong style={{ color: BRAND }}>{c.days_remaining}</strong>} />
      <Row k="Status" v={<StatusPill status={c.status} />} />
      <Row k="Password Cycle" v={`${fmtDate(c.password_cycle_start)} → ${fmtDate(c.password_cycle_expiry)}`} />
      <Row k="Cycle Status" v={c.password_cycle_expired ? <span className="text-red-600 font-medium">Expired</span> : <span className="text-green-600 font-medium">Active{c.password_cycle_days_remaining != null ? ` · ${c.password_cycle_days_remaining}d left` : ""}</span>} />
      <Row k="Workers Affected" v={<strong>{campaign.workersAffected}</strong>} />
      {full && campaign.next?.id && <Row k="Next Campaign" v={`${campaign.next.name} (${fmtDate(campaign.next.start_date)})`} />}
      {full && campaign.previous?.id && <Row k="Previous" v={`${campaign.previous.name}`} />}
    </div>
  );
}

// ------------------------------------------------------------ DETAIL MODALS
function WorkerDetailModal({ id, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    api(`workers/${id}`).then((r) => r.ok ? r.json() : Promise.reject()).then((d) => alive && setData(d)).catch(() => alive && setErr("Could not load worker."));
    return () => { alive = false; };
  }, [id]);
  return (
    <Modal onClose={onClose} wide>
      {err ? <ErrorState msg={err} /> : !data ? <Loading /> : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Photo src={data.worker.photo_url} name={data.worker.name} />
            <div>
              <h3 className="text-lg font-bold text-gray-900">{data.worker.name}</h3>
              <div className="text-sm text-gray-500 flex flex-wrap gap-x-3">
                <span className="font-mono">{data.worker.worker_code}</span>
                {data.worker.mobile && <span className="inline-flex items-center gap-1"><Phone size={12} /> {data.worker.mobile}</span>}
                {data.worker.assembly_name && <span className="inline-flex items-center gap-1"><MapPin size={12} /> {data.worker.assembly_name}{data.worker.ward_name ? ` · ${data.worker.ward_name}` : ""}</span>}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Mini k="Rank" v={data.performance.rank} />
            <Mini k="Total Members" v={data.performance.total} accent />
            <Mini k="Today" v={data.performance.today} />
            <Mini k="This Week" v={data.performance.week} />
            <Mini k="This Month" v={data.performance.month} />
            <Mini k="Assembly Pos." v={data.performance.assemblyPosition ?? "—"} />
            <Mini k="Block Pos." v={data.performance.wardPosition ?? "—"} />
            <Mini k="Status" v={data.worker.worker_status} />
          </div>
          <Panel title="Membership Growth">
            {data.growth.length === 0 ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data.growth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10 }} minTickGap={20} /><YAxis tick={{ fontSize: 10 }} allowDecimals={false} /><Tooltip />
                  <Line type="monotone" dataKey="cumulative" name="Cumulative" stroke="#164FA3" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="members" name="Added" stroke="#0F9D58" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Panel>
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase mb-2">Members Added ({data.members.length})</div>
            {data.members.length === 0 ? <EmptyState msg="This worker has not added any members yet." /> : (
              <div className="overflow-x-auto max-h-64 overflow-y-auto border border-gray-100 rounded-lg">
                <table className="w-full text-sm"><thead className="sticky top-0 bg-gray-50"><tr className="text-left text-gray-400 text-xs uppercase"><th className="px-2 py-1.5">Name</th><th className="px-2 py-1.5">ID</th><th className="px-2 py-1.5">Mobile</th><th className="px-2 py-1.5">Registered</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">{data.members.map((m) => <tr key={m.id}><td className="px-2 py-1.5 font-medium text-gray-800">{m.name}</td><td className="px-2 py-1.5 font-mono text-xs text-gray-500">{m.membership_id || "—"}</td><td className="px-2 py-1.5 text-gray-600">{m.mobile || "—"}</td><td className="px-2 py-1.5 text-gray-500 text-xs">{fmtDate(m.registered_at)}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function MemberDetailModal({ id, onClose }) {
  const [m, setM] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    api(`members/${id}`).then((r) => r.ok ? r.json() : Promise.reject()).then((d) => alive && setM(d.member)).catch(() => alive && setErr("Could not load member."));
    return () => { alive = false; };
  }, [id]);
  return (
    <Modal onClose={onClose}>
      {err ? <ErrorState msg={err} /> : !m ? <Loading /> : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Photo src={m.photo_url} name={m.name} />
            <div><h3 className="text-lg font-bold text-gray-900">{m.name}</h3><div className="text-sm text-gray-500 font-mono">{m.membership_id || "—"}</div></div>
          </div>
          <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-sm text-blue-800">Added By: <strong>{m.worker_name || "—"}</strong> {m.worker_code ? <span className="font-mono text-xs">({m.worker_code})</span> : null}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Row k="Mobile" v={m.mobile || "—"} />
            <Row k="Registered" v={fmtDateTime(m.registered_at)} />
            <Row k="Assembly" v={m.assembly_name || "—"} />
            <Row k="Block / Ward" v={m.ward_name || "—"} />
            <Row k="Booth" v={m.booth_name || "—"} />
            <Row k="Address" v={m.address || "—"} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Mini k="Certificate" v={<CommPill status={m.certificate_status} />} />
            <Mini k="WhatsApp" v={<CommPill status={m.whatsapp_status} />} />
            <Mini k="SMS" v={<CommPill status={m.sms_status} />} />
          </div>
          {m.certificate_generated_at && <div className="text-xs text-gray-500">Certificate generated: {fmtDateTime(m.certificate_generated_at)}</div>}
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------ UI PRIMITIVES
const ctrl = "h-9 rounded-lg border border-gray-200 text-sm px-2 text-gray-700 bg-white";
const ctrl2 = "w-full h-10 rounded-lg border border-gray-200 text-sm px-3 text-gray-900";

function FilterSelect({ label, value, onChange, options, disabled }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-gray-500 mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={`${ctrl} ${disabled ? "opacity-50" : ""} max-w-[190px]`}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
function Card({ icon: Icon, label, value, sub, tint }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3.5">
      <div className="flex items-center gap-2 mb-1.5"><div className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: tint }}><Icon size={16} /></div></div>
      <div className="text-2xl font-bold text-gray-900 leading-none">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}
function Panel({ title, right, children, className = "" }) {
  return (
    <div className={`bg-white border border-gray-200 rounded-xl p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">{title}</h3>{right}</div>
      {children}
    </div>
  );
}
function Th({ children, onClick, active, dir, className = "" }) {
  return <th onClick={onClick} className={`px-3 py-2.5 font-semibold cursor-pointer select-none ${className}`}><span className="inline-flex items-center gap-1">{children}<ArrowUpDown size={12} className={active ? "text-[#164FA3]" : "text-gray-300"} /></span></th>;
}
function Pager({ meta, onPage }) {
  if (!meta || meta.total === 0) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-600">
      <span>Page {meta.page} of {meta.pages} · {meta.total} total</span>
      <div className="flex items-center gap-1">
        <button disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} className="p-1.5 rounded-md border border-gray-200 disabled:opacity-40 hover:bg-gray-50"><ChevronLeft size={16} /></button>
        <button disabled={meta.page >= meta.pages} onClick={() => onPage(meta.page + 1)} className="p-1.5 rounded-md border border-gray-200 disabled:opacity-40 hover:bg-gray-50"><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}
function StatusPill({ status }) {
  const s = String(status || "").toLowerCase();
  const cls = s === "active" ? "bg-green-50 text-green-700 border-green-200" : s === "inactive" || s === "closed" ? "bg-red-50 text-red-600 border-red-200" : s === "upcoming" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-amber-50 text-amber-700 border-amber-200";
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>{status || "—"}</span>;
}
function CommPill({ status }) {
  const s = String(status || "").toLowerCase();
  const map = { sent: ["bg-green-50 text-green-700 border-green-200", CheckCircle2], generated: ["bg-green-50 text-green-700 border-green-200", CheckCircle2], pending: ["bg-amber-50 text-amber-700 border-amber-200", Clock], failed: ["bg-red-50 text-red-600 border-red-200", XCircle], not_required: ["bg-gray-100 text-gray-500 border-gray-200", null] };
  const [cls, Icon] = map[s] || ["bg-gray-100 text-gray-500 border-gray-200", null];
  return <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border ${cls}`}>{Icon && <Icon size={11} />}{s === "not_required" ? "N/R" : (status || "—")}</span>;
}
function Row({ k, v }) { return <div className="flex justify-between gap-3 py-0.5"><span className="text-gray-400">{k}</span><span className="text-gray-800 text-right">{v}</span></div>; }
function Mini({ k, v, accent }) { return <div className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2"><div className="text-[11px] text-gray-400 uppercase">{k}</div><div className={`text-lg font-bold ${accent ? "" : "text-gray-900"}`} style={accent ? { color: BRAND } : undefined}>{v}</div></div>; }
function Photo({ src, name }) {
  if (src) return <img src={src} alt={name} className="w-14 h-14 rounded-full object-cover border border-gray-200" onError={(e) => { e.target.style.display = "none"; }} />;
  return <div className="w-14 h-14 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-[#164FA3] font-bold text-lg">{String(name || "?").trim().charAt(0).toUpperCase()}</div>;
}
function Loading() { return <div className="flex items-center justify-center py-16"><Loader2 className="animate-spin" style={{ color: BRAND }} size={26} /></div>; }
function EmptyChart() { return <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">No data for the selected filters.</div>; }
function EmptyState({ msg }) { return <div className="py-8 text-center text-gray-400 text-sm">{msg}</div>; }
function ErrorState({ msg, onRetry }) {
  return (
    <div className="py-10 text-center">
      <AlertCircle size={26} className="mx-auto text-red-400 mb-2" />
      <p className="text-sm text-gray-600">{msg}</p>
      {onRetry && <button onClick={onRetry} className="mt-3 h-9 px-4 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5"><RefreshCw size={14} /> Retry</button>}
    </div>
  );
}
function Modal({ children, onClose, wide }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-xl w-full ${wide ? "max-w-3xl" : "max-w-lg"} max-h-[90vh] overflow-hidden flex flex-col`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end px-4 pt-3"><button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400"><X size={20} /></button></div>
        <div className="overflow-y-auto px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}
