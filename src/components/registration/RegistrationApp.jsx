"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  BarChart3, Check, ChevronLeft, ChevronRight, Copy, Download, Link2, Loader2,
  MessageCircle, Plus, RefreshCw, Search, Settings2, Shield, Trash2, Trophy,
  UserPlus, Users, Vote, X,
} from "lucide-react";
import { isTopAdmin } from "@/lib/permissions";
import { usePageGuard } from "@/components/usePageGuard";

// Voter & Worker Registration — the admin side of the public link drive.
//
// Four tabs, one data model:
//   Dashboard      KPIs + worker-wise and ward-wise performance
//   Workers & Links  the roster; every row owns the link that is sent out
//   Registrations  every person collected, with the worker who added them
//   Drives         the election drives the links belong to
//
// Every table here is server-aggregated (see lib/registrationStats.js); the
// client never sums rows to produce a total, so what an admin reads is exactly
// what the database counted.
const BRAND = "#164FA3";
const PERIODS = [
  ["", "All time"], ["today", "Today"], ["yesterday", "Yesterday"],
  ["week", "This Week"], ["month", "This Month"],
];

const cardCls = "bg-white border border-gray-200 rounded-2xl shadow-sm";
const inputCls =
  "h-10 px-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-900 " +
  "focus:outline-none focus:ring-2 focus:ring-[#164FA3] focus:border-transparent";
const btnCls = "h-10 px-4 rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60";

function Stat({ icon: Icon, label, value, sub, tone = "brand" }) {
  const tones = {
    brand: "bg-blue-50 text-blue-700",
    green: "bg-green-50 text-green-700",
    amber: "bg-amber-50 text-amber-700",
    gray: "bg-gray-100 text-gray-600",
  };
  return (
    <div className={`${cardCls} p-4`}>
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tones[tone]}`}><Icon size={19} /></div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900 leading-tight truncate">{value}</p>
          {sub ? <p className="text-xs text-gray-500 truncate">{sub}</p> : null}
        </div>
      </div>
    </div>
  );
}

// A shareable link with the two actions that actually get used: copy it, or hand
// it straight to WhatsApp. `origin` is read on the client so the link is whatever
// host the admin is really on (localhost while testing, the live domain in
// production) rather than a hardcoded guess.
function ShareLink({ path, message, compact, big }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const url = origin && path ? `${origin}${path}` : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* the link stays selectable in the box beside the button */ }
  }
  if (!path) return <span className="text-xs text-gray-400">—</span>;

  return (
    <div className={compact ? "flex items-center gap-1.5" : "flex flex-wrap items-center gap-2"}>
      <code className={`bg-gray-100 rounded px-2 py-1 truncate ${big ? "text-sm font-semibold text-gray-900 px-3 py-2" : "text-[11px]"} ${compact ? "max-w-[190px]" : "max-w-[460px]"}`}>
        {url || "…"}
      </code>
      <button onClick={copy} title="Copy link" className={`rounded-md hover:bg-gray-100 text-gray-500 ${big ? "p-2" : "p-1.5"}`}>
        {copied ? <Check size={big ? 18 : 15} className="text-green-600" /> : <Copy size={big ? 18 : 15} />}
      </button>
      <a href={`https://wa.me/?text=${encodeURIComponent(`${message}\n${url}`)}`} target="_blank" rel="noreferrer"
         title="Share on WhatsApp" className={`rounded-md hover:bg-gray-100 text-green-600 ${big ? "p-2" : "p-1.5"}`}>
        <MessageCircle size={big ? 18 : 15} />
      </a>
    </div>
  );
}

// The on/off switch for the public link. There is no separate "link enabled"
// flag to fall out of sync: /join opens the active drive, so switching the link
// off simply closes that drive, and switching it on reopens the most recent one.
// The URL itself never changes, which is what makes it safe to print and forward.
function LinkSwitch({ drive, drives, reload, onError }) {
  const [busy, setBusy] = useState(false);
  // When nothing is live, the switch reopens the drive that ran most recently.
  const target = drive || [...drives].sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id)[0] || null;
  const on = !!drive;

  async function toggle() {
    if (!target) { onError("Create an election drive first — the link opens whichever drive is active."); return; }
    if (on && !window.confirm(`Switch the public link OFF? “${target.name}” will close and anyone opening the link will be told registration is not open.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/registration/campaigns/${target.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: on ? "closed" : "active" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { onError(d?.message || "Could not change the link."); return; }
      reload();
    } catch { onError("Could not change the link."); }
    finally { setBusy(false); }
  }

  return (
    <button onClick={toggle} disabled={busy}
            title={on ? "Switch the public link off" : "Switch the public link on"}
            className={`${btnCls} border ${on ? "bg-green-50 text-green-700 border-green-300" : "bg-gray-100 text-gray-600 border-gray-300"}`}>
      {busy ? <Loader2 className="animate-spin" size={16} /> : <span className={`w-2.5 h-2.5 rounded-full ${on ? "bg-green-500" : "bg-gray-400"}`} />}
      {on ? "Link is ON" : "Link is OFF"}
    </button>
  );
}

function RankBadge({ rank }) {
  const tone = rank === 1 ? "bg-amber-100 text-amber-800" : rank === 2 ? "bg-gray-200 text-gray-700"
    : rank === 3 ? "bg-orange-100 text-orange-800" : "bg-gray-100 text-gray-500";
  return <span className={`inline-flex w-7 h-7 rounded-full items-center justify-center text-xs font-bold ${tone}`}>{rank}</span>;
}

export default function RegistrationApp() {
  const { data: session } = useSession();
  const router = useRouter();
  const { ready, allowed } = usePageGuard("voter_registration", isTopAdmin(session));

  const [tab, setTab] = useState("dashboard");
  const [campaigns, setCampaigns] = useState([]);
  const [campaignId, setCampaignId] = useState("");
  const [period, setPeriod] = useState("");
  const [ward, setWard] = useState("");
  const [err, setErr] = useState("");

  // Shared filter query string — the one definition every tab and every export
  // builds from, so the screen and the CSV can never drift apart.
  const filterQs = useCallback((extra = {}) => {
    const p = new URLSearchParams();
    if (campaignId) p.set("campaign_id", campaignId);
    if (period) p.set("period", period);
    if (ward) p.set("ward", ward);
    for (const [k, v] of Object.entries(extra)) if (v !== "" && v != null) p.set(k, String(v));
    return p.toString();
  }, [campaignId, period, ward]);

  const loadCampaigns = useCallback(async () => {
    try {
      const r = await fetch("/api/registration/campaigns", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      setCampaigns(d.campaigns || []);
      // Default to the running drive so the dashboard opens on live numbers.
      setCampaignId((cur) => cur || String(d.campaigns?.find((c) => c.status === "active")?.id || ""));
    } catch { /* the tabs surface their own errors */ }
  }, []);

  useEffect(() => { if (allowed) loadCampaigns(); }, [allowed, loadCampaigns]);

  if (!ready) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="animate-spin" style={{ color: BRAND }} size={28} /></div>;
  }
  if (!allowed) {
    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center">
        <div className="max-w-md w-full bg-white border border-gray-200 rounded-2xl shadow-sm p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4"><Shield size={26} /></div>
          <h2 className="text-lg font-bold text-gray-900">Access Denied</h2>
          <p className="text-sm text-gray-500 mt-2">Voter &amp; Worker Registration is restricted to state-level administrators.</p>
          <button onClick={() => router.push("/dashboard")} className={`${btnCls} mt-6 text-white`} style={{ background: BRAND }}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  // Which drive /join currently opens: the active one. The backend picks the
  // newest active drive, so this mirrors that rule exactly.
  const liveDrive = campaigns.filter((c) => c.status === "active")
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id)[0] || null;

  const TABS = [
    ["dashboard", "Dashboard", BarChart3],
    ["workers", "Workers & Links", Link2],
    ["people", "Registrations", Users],
    ["drives", "Election Drives", Settings2],
  ];

  return (
    <div className="max-w-[1500px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white" style={{ background: BRAND }}><Vote size={22} /></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Voter &amp; Worker Registration</h1>
            <p className="text-sm text-gray-500">Unique worker links · automatic attribution</p>
          </div>
        </div>
      </div>

      {/* Filters shared by every tab */}
      <div className={`${cardCls} p-3 mb-4 flex flex-wrap items-center gap-2`}>
        <select className={inputCls} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
          <option value="">All election drives</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.status === "closed" ? " (closed)" : ""}</option>
          ))}
        </select>
        <select className={inputCls} value={period} onChange={(e) => setPeriod(e.target.value)}>
          {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input className={`${inputCls} w-36`} placeholder="Ward no." value={ward} onChange={(e) => setWard(e.target.value)} />
        {(period || ward) && (
          <button onClick={() => { setPeriod(""); setWard(""); }} className="text-sm text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
            <X size={14} />Clear
          </button>
        )}
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-200 overflow-x-auto">
        {TABS.map(([key, label, Icon]) => (
          <button key={key} onClick={() => { setTab(key); setErr(""); }}
                  className={`px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-2 border-b-2 -mb-px whitespace-nowrap ${
                    tab === key ? "border-current" : "border-transparent text-gray-500 hover:text-gray-800"}`}
                  style={tab === key ? { color: BRAND } : undefined}>
            <Icon size={16} />{label}
          </button>
        ))}
      </div>

      {/* THE link. One fixed URL for the whole state — it always opens whichever
          drive is active, so it never has to be reissued, and the switch below
          turns it on and off. Anyone who opens it enters their own name and
          mobile, and that mobile number is what credits their work. */}
      <div className={`${cardCls} p-4 mb-4 border-l-4`} style={{ borderLeftColor: liveDrive ? BRAND : "#d1d5db" }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <Link2 size={16} style={{ color: liveDrive ? BRAND : "#9ca3af" }} />Public registration link
            </h2>
            <p className="text-xs text-gray-500 mt-0.5 max-w-2xl">
              {liveDrive
                ? <>The general link, for the public to register themselves. It always opens the live drive — <span className="font-semibold text-gray-700">{liveDrive.name}</span>. Registrations through it are counted for the drive but credited to no karyakarta. To credit someone, generate their own link in <span className="font-semibold text-gray-700">Workers &amp; Links</span>.</>
                : <>The link is switched off — no drive is open, so anyone who opens it sees “Registration is not open right now”. Turn on a drive below to make it live.</>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a href="/join" target="_blank" rel="noreferrer" className={`${btnCls} border border-gray-300 text-gray-700 bg-white`}>Open form</a>
            <LinkSwitch drive={liveDrive} drives={campaigns} reload={loadCampaigns} onError={setErr} />
          </div>
        </div>
        <div className="mt-3">
          <ShareLink big path="/join"
                     message={"आम आदमी पार्टी छत्तीसगढ़ — मतदाता एवं कार्यकर्ता पंजीयन\n\nकृपया इसी लिंक से पंजीयन करें:"} />
        </div>
      </div>

      {err ? <p className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{err}</p> : null}

      {tab === "dashboard" && <DashboardTab filterQs={filterQs} onWard={setWard} onError={setErr} />}
      {tab === "workers" && <WorkersTab filterQs={filterQs} campaignId={campaignId} campaigns={campaigns} onError={setErr} />}
      {tab === "people" && <PeopleTab filterQs={filterQs} onError={setErr} />}
      {tab === "drives" && <DrivesTab campaigns={campaigns} reload={loadCampaigns} onError={setErr} />}
    </div>
  );
}

// ------------------------------------------------------------------ DASHBOARD
function DashboardTab({ filterQs, onWard, onError }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/registration/dashboard?${filterQs({ worker_limit: 10, ward_limit: 20 })}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      setData(await r.json());
    } catch {
      onError("Could not load the dashboard. Please try again.");
    } finally { setLoading(false); }
  }, [filterQs, onError]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div className="py-16 flex justify-center"><Loader2 className="animate-spin" style={{ color: BRAND }} size={26} /></div>;
  if (!data) return null;

  const s = data.summary;
  const p = s.period;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={Vote} label="Total Voters Added" value={p.voters.toLocaleString("en-IN")} sub={`${s.lifetime.voters.toLocaleString("en-IN")} all time`} />
        <Stat icon={UserPlus} label="Total New Workers" value={p.new_workers.toLocaleString("en-IN")} sub={`${s.lifetime.new_workers.toLocaleString("en-IN")} all time`} tone="green" />
        <Stat icon={BarChart3} label="Total Registrations" value={p.total.toLocaleString("en-IN")} sub={`${s.lifetime.total.toLocaleString("en-IN")} all time`} tone="amber" />
        {/* Where they came from: a karyakarta's generated link, or the general
            /join link with nobody behind it. The split is the whole point of
            generating links, so it belongs on the front page. */}
        <Stat icon={Link2} label="Through worker links" value={(p.total - p.direct).toLocaleString("en-IN")}
              sub={`${p.direct.toLocaleString("en-IN")} direct via /join · ${s.active_workers} links active`} tone="gray" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[["today", "Today"], ["yesterday", "Yesterday"], ["week", "This Week"], ["month", "This Month"]].map(([k, label]) => (
          <div key={k} className={`${cardCls} p-3`}>
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-xl font-bold text-gray-900">{s.buckets[k].total.toLocaleString("en-IN")}</p>
            <p className="text-[11px] text-gray-500">{s.buckets[k].voters} voters · {s.buckets[k].new_workers} workers</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className={`${cardCls} p-4 flex items-center gap-3`}>
          <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center"><Trophy size={20} /></div>
          <div className="min-w-0">
            <p className="text-xs text-gray-500">Top Performing Worker</p>
            <p className="font-bold text-gray-900 truncate">{s.top_worker?.name || "—"}</p>
            <p className="text-xs text-gray-500">
              {s.top_worker ? `${s.top_worker.total} total · ${s.top_worker.voters} voters · ${s.top_worker.new_workers} workers` : "No registrations yet"}
            </p>
          </div>
        </div>
        <div className={`${cardCls} p-4 flex items-center gap-3`}>
          <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center"><Trophy size={20} /></div>
          <div className="min-w-0">
            <p className="text-xs text-gray-500">Best Performing Ward</p>
            <p className="font-bold text-gray-900 truncate">{s.top_ward ? `Ward ${s.top_ward.ward_number}` : "—"}</p>
            <p className="text-xs text-gray-500">
              {s.top_ward ? `${s.top_ward.total} total · ${s.top_ward.voters} voters · ${s.top_ward.new_workers} workers` : "No registrations yet"}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <RankTable
          title="Worker-wise Performance"
          subtitle="Top 10"
          exportHref={`/api/registration/export?${filterQs({ report: "workers" })}`}
          head={["Rank", "Worker Name", "Mobile", "Voters", "Workers", "Total"]}
          rows={data.workers.map((w) => [
            <RankBadge key="r" rank={w.rank} />,
            <span key="n" className="font-semibold text-gray-900">{w.name}<span className="block text-[11px] font-normal text-gray-400 font-mono">{w.worker_code}</span></span>,
            w.mobile || "—", w.voters, w.new_workers,
            <span key="t" className="font-bold text-gray-900">{w.total}</span>,
          ])}
          empty="No workers yet — add them in the Workers & Links tab."
        />
        <RankTable
          title="Ward-wise Performance"
          subtitle={`${data.wards.length} ward${data.wards.length === 1 ? "" : "s"}`}
          exportHref={`/api/registration/export?${filterQs({ report: "wards" })}`}
          head={["Rank", "Ward No.", "Voters", "Workers", "Total"]}
          rows={data.wards.map((w) => [
            <RankBadge key="r" rank={w.rank} />,
            <button key="w" onClick={() => onWard(w.ward_number)} className="font-semibold text-gray-900 hover:underline">Ward {w.ward_number}</button>,
            w.voters, w.new_workers,
            <span key="t" className="font-bold text-gray-900">{w.total}</span>,
          ])}
          empty="No ward data yet."
        />
      </div>
    </div>
  );
}

function RankTable({ title, subtitle, head, rows, empty, exportHref }) {
  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div>
          <h3 className="text-sm font-bold text-gray-900">{title}</h3>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
        {exportHref ? (
          <a href={exportHref} className="text-xs font-semibold inline-flex items-center gap-1.5 text-gray-600 hover:text-gray-900">
            <Download size={14} />CSV
          </a>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 bg-gray-50">
              {head.map((h) => <th key={h} className="px-4 py-2 font-semibold whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={head.length} className="px-4 py-8 text-center text-gray-500">{empty}</td></tr>
            ) : rows.map((cells, i) => (
              <tr key={i} className="border-t border-gray-100">
                {cells.map((c, j) => <td key={j} className="px-4 py-2.5 whitespace-nowrap">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- WORKERS/LINKS
function WorkersTab({ filterQs, campaignId, campaigns, onError }) {
  const [rows, setRows] = useState([]);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => { const t = setTimeout(() => { setDebounced(search); setPage(1); }, 350); return () => clearTimeout(t); }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/registration/workers?${filterQs({ page, pageSize: 25, search: debounced })}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      const d = await r.json();
      setRows(d.workers || []); setPages(d.pages || 1); setTotal(d.total || 0);
    } catch {
      onError("Could not load the worker list.");
    } finally { setLoading(false); }
  }, [filterQs, page, debounced, onError]);

  useEffect(() => { load(); }, [load]);

  const linkOf = (token) => `${origin}/r/${token}`;

  async function copyLink(w) {
    try {
      await navigator.clipboard.writeText(linkOf(w.token));
      setCopied(w.id);
      setTimeout(() => setCopied((c) => (c === w.id ? null : c)), 1800);
    } catch {
      onError("Could not copy the link. Select and copy it manually.");
    }
  }

  // Pre-filled WhatsApp message the admin sends to that one worker.
  function whatsappHref(w) {
    const msg = `नमस्ते ${w.name},\n\nआम आदमी पार्टी छत्तीसगढ़ — मतदाता एवं कार्यकर्ता पंजीयन\n\nयह आपका व्यक्तिगत लिंक है. इसी लिंक से पंजीयन करें ताकि आपका काम आपके नाम दर्ज हो:\n${linkOf(w.token)}\n\nआपकी कार्यकर्ता ID: ${w.worker_code || ""}`;
    const to = w.mobile ? `91${w.mobile}` : "";
    return `https://wa.me/${to}?text=${encodeURIComponent(msg)}`;
  }

  async function patch(id, body) {
    try {
      const r = await fetch(`/api/registration/workers/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { onError(d?.message || "Could not update this worker."); return; }
      load();
    } catch { onError("Could not update this worker."); }
  }

  async function remove(w) {
    if (!window.confirm(`Delete the link for ${w.name}? This cannot be undone.`)) return;
    try {
      const r = await fetch(`/api/registration/workers/${w.id}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { onError(d?.message || "Could not delete this worker."); return; }
      load();
    } catch { onError("Could not delete this worker."); }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input className={`${inputCls} pl-9 w-64`} placeholder="Search worker, mobile, ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <span className="text-sm text-gray-500">{total} worker{total === 1 ? "" : "s"}</span>
        <div className="ml-auto flex items-center gap-2">
          <a href={`/api/registration/export?${filterQs({ report: "workers" })}`} className={`${btnCls} border border-gray-300 text-gray-700 bg-white`}>
            <Download size={16} />Export
          </a>
          <button onClick={() => setAdding(true)} className={`${btnCls} text-white`} style={{ background: BRAND }}>
            <Plus size={16} />Generate links
          </button>
        </div>
      </div>

      {/* Each row IS one generated link, and the counts beside it are exactly
          how many people registered through it — the answer to "how is this
          karyakarta doing", with no cross-referencing. */}
      <p className="text-xs text-gray-500">
        Generate a link for each karyakarta and send it to them to share. Everyone who registers through their link is credited to them, and
        the counts below are that link&apos;s own totals.
      </p>

      {adding && (
        <AddWorkers campaignId={campaignId} campaigns={campaigns}
                    onClose={() => setAdding(false)}
                    onDone={() => { setAdding(false); load(); }}
                    onError={onError} />
      )}

      <div className={`${cardCls} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 bg-gray-50">
                {["#", "Karyakarta", "Mobile", "Ward / Area", "Voters", "New workers", "Registered via link", "Their link", "Status", ""].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center"><Loader2 className="animate-spin inline" style={{ color: BRAND }} size={22} /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-500">No karyakarta links yet. Generate one to start crediting registrations.</td></tr>
              ) : rows.map((w) => (
                <tr key={w.id} className="border-t border-gray-100 hover:bg-gray-50/60">
                  <td className="px-3 py-2.5"><RankBadge rank={w.rank} /></td>
                  <td className="px-3 py-2.5">
                    <span className="font-semibold text-gray-900">{w.name}</span>
                    <span className="block text-[11px] text-gray-400 font-mono">{w.worker_code}</span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{w.mobile || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{[w.ward_number, w.area_booth].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-3 py-2.5">{w.voters}</td>
                  <td className="px-3 py-2.5">{w.new_workers}</td>
                  <td className="px-3 py-2.5 font-bold text-gray-900">{w.total}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <code className="text-[11px] bg-gray-100 rounded px-2 py-1 max-w-[190px] truncate">{origin ? linkOf(w.token) : "…"}</code>
                      <button onClick={() => copyLink(w)} title="Copy link" className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500">
                        {copied === w.id ? <Check size={15} className="text-green-600" /> : <Copy size={15} />}
                      </button>
                      <a href={whatsappHref(w)} target="_blank" rel="noreferrer" title="Send on WhatsApp" className="p-1.5 rounded-md hover:bg-gray-100 text-green-600">
                        <MessageCircle size={15} />
                      </a>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <button onClick={() => patch(w.id, { status: w.status === "active" ? "disabled" : "active" })}
                            className={`text-[11px] font-semibold px-2 py-1 rounded-md border ${
                              w.status === "active" ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-500 border-gray-200"}`}>
                      {w.status === "active" ? "Active" : "Disabled"}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <button onClick={() => { if (window.confirm(`Issue a NEW link for ${w.name}? Their current link will stop working immediately.`)) patch(w.id, { regenerate_token: true }); }}
                              title="Issue a new link" className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500"><RefreshCw size={15} /></button>
                      <button onClick={() => remove(w)} title="Delete" className="p-1.5 rounded-md hover:bg-red-50 text-red-500"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} pages={pages} onPage={setPage} />
      </div>
    </div>
  );
}

function AddWorkers({ campaignId, campaigns, onClose, onDone, onError }) {
  const [drive, setDrive] = useState(campaignId || String(campaigns.find((c) => c.status === "active")?.id || ""));
  const [mode, setMode] = useState("single");
  const [form, setForm] = useState({ name: "", mobile: "", ward_number: "", area_booth: "" });
  const [bulk, setBulk] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!drive) { onError("Create an election drive first, then add workers to it."); return; }
    setSaving(true);
    try {
      const body = mode === "bulk" ? { campaign_id: drive, bulk } : { campaign_id: drive, ...form };
      const r = await fetch("/api/registration/workers", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { onError(d?.message || "Could not add workers."); return; }
      if (d.skipped?.length) onError(`${d.count} added. ${d.skipped.length} skipped — those mobile numbers already have a link.`);
      onDone();
    } catch { onError("Could not add workers."); }
    finally { setSaving(false); }
  }

  return (
    <div className={`${cardCls} p-4`}>
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Generate karyakarta links</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            One link per karyakarta. Send it to them, they share it, and every registration through it is counted as theirs.
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500"><X size={16} /></button>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select className={inputCls} value={drive} onChange={(e) => setDrive(e.target.value)}>
          <option value="">Select election drive…</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          {[["single", "One worker"], ["bulk", "Paste a list"]].map(([v, l]) => (
            <button key={v} onClick={() => setMode(v)}
                    className={`h-10 px-4 text-sm font-semibold ${mode === v ? "text-white" : "bg-white text-gray-600"}`}
                    style={mode === v ? { background: BRAND } : undefined}>{l}</button>
          ))}
        </div>
      </div>

      {mode === "single" ? (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <input className={inputCls} placeholder="Worker name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={inputCls} placeholder="Mobile number" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          <input className={inputCls} placeholder="Ward no." value={form.ward_number} onChange={(e) => setForm({ ...form, ward_number: e.target.value })} />
          <input className={inputCls} placeholder="Area / Booth" value={form.area_booth} onChange={(e) => setForm({ ...form, area_booth: e.target.value })} />
        </div>
      ) : (
        <>
          <textarea className={`${inputCls} w-full h-36 py-2 font-mono text-[13px]`} value={bulk} onChange={(e) => setBulk(e.target.value)}
                    placeholder={"One worker per line:\nरमेश साहू, 9876543210, 25, बूथ 12\nसुनीता वर्मा, 9876500011, 18"} />
          <p className="text-xs text-gray-500 mt-1">Name, Mobile, Ward, Area/Booth — comma or tab separated. Only the name is required; each line gets its own unique link.</p>
        </>
      )}

      <div className="flex justify-end gap-2 mt-3">
        <button onClick={onClose} className={`${btnCls} border border-gray-300 text-gray-700 bg-white`}>Cancel</button>
        <button onClick={save} disabled={saving} className={`${btnCls} text-white`} style={{ background: BRAND }}>
          {saving ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}Create links
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- REGISTRATIONS
function PeopleTab({ filterQs, onError }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("active");
  const [source, setSource] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { const t = setTimeout(() => { setDebounced(search); setPage(1); }, 350); return () => clearTimeout(t); }, [search]);

  const qs = useCallback((extra = {}) => filterQs({ person_type: type, status, source, search: debounced, ...extra }), [filterQs, type, status, source, debounced]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/registration/people?${qs({ page, pageSize: 25 })}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      const d = await r.json();
      setRows(d.people || []); setTotal(d.total || 0); setPages(d.pages || 1);
    } catch { onError("Could not load registrations."); }
    finally { setLoading(false); }
  }, [qs, page, onError]);

  useEffect(() => { load(); }, [load]);

  async function setRowStatus(id, next) {
    try {
      const r = await fetch(`/api/registration/people/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }),
      });
      if (!r.ok) throw new Error();
      load();
    } catch { onError("Could not update this registration."); }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input className={`${inputCls} pl-9 w-64`} placeholder="Search person, mobile, worker" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className={inputCls} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">All types</option>
          <option value="voter">Voters</option>
          <option value="worker">Wants to be a worker</option>
        </select>
        <select className={inputCls} value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }}>
          <option value="">All sources</option>
          <option value="worker">Through a karyakarta link</option>
          <option value="direct">Direct via /join</option>
        </select>
        <select className={inputCls} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="active">Counted</option>
          <option value="duplicate">Duplicates</option>
          <option value="rejected">Rejected</option>
        </select>
        <span className="text-sm text-gray-500">{total.toLocaleString("en-IN")} record{total === 1 ? "" : "s"}</span>
        <a href={`/api/registration/export?${qs({ report: "registrations" })}`} className={`${btnCls} ml-auto border border-gray-300 text-gray-700 bg-white`}>
          <Download size={16} />Export CSV
        </a>
      </div>

      <div className={`${cardCls} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 bg-gray-50">
                {["Date & time", "Type", "Name", "Mobile", "Ward / Area", "Address", "Added by", "Status"].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center"><Loader2 className="animate-spin inline" style={{ color: BRAND }} size={22} /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-500">No registrations for these filters yet.</td></tr>
              ) : rows.map((p) => (
                <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50/60 align-top">
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                    {new Date(p.registered_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[11px] font-semibold px-2 py-1 rounded-md border ${
                      p.person_type === "worker" ? "bg-green-50 text-green-700 border-green-200" : "bg-blue-50 text-blue-700 border-blue-200"}`}>
                      {p.person_type === "worker" ? "New worker" : "Voter"}
                    </span>
                    {p.worker_role ? <span className="block text-[11px] text-gray-500 mt-1">{p.worker_role}</span> : null}
                  </td>
                  <td className="px-3 py-2.5 font-semibold text-gray-900">{p.name}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{p.mobile || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{[p.effective_ward, p.area_booth].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-3 py-2.5 text-gray-600 max-w-[240px]"><span className="line-clamp-2">{p.address || "—"}</span></td>
                  {/* No worker means it came through the general /join link. */}
                  <td className="px-3 py-2.5">
                    {p.worker_name ? (
                      <>
                        <span className="font-semibold text-gray-900">{p.worker_name}</span>
                        <span className="block text-[11px] text-gray-400 font-mono">{p.worker_code}</span>
                      </>
                    ) : (
                      <span className="text-[11px] font-semibold px-2 py-1 rounded-md border bg-gray-100 text-gray-500 border-gray-200">Direct · /join</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <select className="text-[12px] border border-gray-300 rounded-md px-2 py-1 bg-white"
                            value={p.status} onChange={(e) => setRowStatus(p.id, e.target.value)}>
                      <option value="active">Counted</option>
                      <option value="duplicate">Duplicate</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} pages={pages} onPage={setPage} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- DRIVES
const BLANK_DRIVE = { name: "", election_type: "assembly", constituency: "", ward_number: "", election_year: String(new Date().getFullYear()), status: "active" };

function DrivesTab({ campaigns, reload, onError }) {
  const [form, setForm] = useState(BLANK_DRIVE);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.name.trim()) { onError("Enter the election name."); return; }
    setSaving(true);
    try {
      const r = await fetch(editId ? `/api/registration/campaigns/${editId}` : "/api/registration/campaigns", {
        method: editId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { onError(d?.message || "Could not save this drive."); return; }
      setForm(BLANK_DRIVE); setEditId(null); reload();
    } catch { onError("Could not save this drive."); }
    finally { setSaving(false); }
  }

  // Opening a drive is the same action as switching the public link on, so both
  // controls route through here.
  async function setStatus(c, status) {
    try {
      const r = await fetch(`/api/registration/campaigns/${c.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { onError(d?.message || "Could not change this drive."); return; }
      reload();
    } catch { onError("Could not change this drive."); }
  }

  async function remove(c) {
    if (!window.confirm(`Delete "${c.name}"? Its worker links will be removed too.`)) return;
    try {
      const r = await fetch(`/api/registration/campaigns/${c.id}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { onError(d?.message || "Could not delete this drive."); return; }
      reload();
    } catch { onError("Could not delete this drive."); }
  }

  return (
    <div className="space-y-3">
      <div className={`${cardCls} p-4`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">{editId ? "Edit election drive" : "New election drive"}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          <input className={inputCls} placeholder="Election name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className={inputCls} value={form.election_type} onChange={(e) => setForm({ ...form, election_type: e.target.value })}>
            <option value="assembly">Assembly</option>
            <option value="lok_sabha">Lok Sabha</option>
          </select>
          <input className={inputCls} placeholder="Assembly / Lok Sabha" value={form.constituency} onChange={(e) => setForm({ ...form, constituency: e.target.value })} />
          <input className={inputCls} placeholder="Ward number" value={form.ward_number} onChange={(e) => setForm({ ...form, ward_number: e.target.value })} />
          <input className={inputCls} placeholder="Election year" value={form.election_year} onChange={(e) => setForm({ ...form, election_year: e.target.value })} />
        </div>
        <div className="flex justify-end gap-2 mt-3">
          {editId ? <button onClick={() => { setForm(BLANK_DRIVE); setEditId(null); }} className={`${btnCls} border border-gray-300 text-gray-700 bg-white`}>Cancel</button> : null}
          <button onClick={save} disabled={saving} className={`${btnCls} text-white`} style={{ background: BRAND }}>
            {saving ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}{editId ? "Save changes" : "Create drive"}
          </button>
        </div>
      </div>

      <div className={`${cardCls} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 bg-gray-50">
                {["Election", "Constituency", "Ward", "Year", "Workers", "Registrations", "Public link", ""].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-500">No election drives yet. Create one to switch the public link on.</td></tr>
              ) : campaigns.map((c) => (
                <tr key={c.id} className="border-t border-gray-100">
                  <td className="px-3 py-2.5">
                    <span className="font-semibold text-gray-900">{c.name}</span>
                    <span className="block text-[11px] text-gray-500">{c.election_type === "lok_sabha" ? "Lok Sabha" : "Assembly"}</span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">{c.constituency || "—"}</td>
                  <td className="px-3 py-2.5 text-gray-600">{c.ward_number || "—"}</td>
                  <td className="px-3 py-2.5 text-gray-600">{c.election_year || "—"}</td>
                  <td className="px-3 py-2.5">{c.worker_count}</td>
                  <td className="px-3 py-2.5 font-semibold">{c.registration_count}</td>
                  {/* Opening a drive is what makes /join live; closing it switches
                      the same link off. One control, no second flag to desync. */}
                  <td className="px-3 py-2.5">
                    <button onClick={() => setStatus(c, c.status === "active" ? "closed" : "active")}
                            title={c.status === "active" ? "Close this drive — the public link switches off" : "Open this drive — the public link points here"}
                            className={`text-[11px] font-semibold px-2 py-1 rounded-md border inline-flex items-center gap-1.5 ${
                              c.status === "active" ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-500 border-gray-200"}`}>
                      <span className={`w-2 h-2 rounded-full ${c.status === "active" ? "bg-green-500" : "bg-gray-400"}`} />
                      {c.status === "active" ? "Live on /join" : "Off"}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setEditId(c.id); setForm({ name: c.name, election_type: c.election_type, constituency: c.constituency || "", ward_number: c.ward_number || "", election_year: c.election_year || "", status: c.status }); }}
                              className="text-xs font-semibold px-2 py-1 rounded-md hover:bg-gray-100 text-gray-600">Edit</button>
                      <button onClick={() => remove(c)} className="p-1.5 rounded-md hover:bg-red-50 text-red-500"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Pager({ page, pages, onPage }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
      <span className="text-xs text-gray-500">Page {page} of {pages}</span>
      <div className="flex gap-1">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="p-2 rounded-lg border border-gray-300 disabled:opacity-40"><ChevronLeft size={15} /></button>
        <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="p-2 rounded-lg border border-gray-300 disabled:opacity-40"><ChevronRight size={15} /></button>
      </div>
    </div>
  );
}
