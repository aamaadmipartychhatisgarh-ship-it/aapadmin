"use client";

import { useState, useEffect, useCallback } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import ProfilePhoto from "@/components/ProfilePhoto";
import {
  LayoutDashboard, Building2, UserSquare2, History, Users, ClipboardCheck,
  BarChart3, Brain, Plus, Pencil, Trash2, X, Loader2, Trophy, Medal, Award,
  CheckCircle2, AlertCircle, MapPin, Phone, Calendar, Wallet, Scale,
  TrendingUp, Target, ShieldAlert, Star, Vote,
} from "lucide-react";

// 10 assessment parameters (keys match the DB columns / API).
const PARAMS = [
  { key: "s_nature", label: "Nature" },
  { key: "s_hardworker", label: "Hard Work" },
  { key: "s_financial", label: "Financial Condition" },
  { key: "s_political", label: "Political Knowledge" },
  { key: "s_public_reach", label: "Public Reach" },
  { key: "s_social_reach", label: "Social / Samajik Reach" },
  { key: "s_personality", label: "Personality" },
  { key: "s_organization", label: "Organization Strength" },
  { key: "s_winning", label: "Winning Ability" },
  { key: "s_acceptability", label: "Public Acceptability" },
];

const TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, scoped: false },
  { key: "mla", label: "MLA Profile", icon: UserSquare2, scoped: true },
  { key: "elections", label: "Election History", icon: History, scoped: true },
  { key: "candidates", label: "AAP Candidates", icon: Users, scoped: true },
  { key: "assessments", label: "Candidate Assessments", icon: ClipboardCheck, scoped: true },
  { key: "comparison", label: "Comparison", icon: BarChart3, scoped: true },
  { key: "analysis", label: "Political Analysis", icon: Brain, scoped: true },
];

const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-[#164FA3]/40";
const lbl = "block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1";
const RANK_ICON = [Trophy, Medal, Award];
const RANK_COLOR = ["text-[#FCB712]", "text-gray-400", "text-amber-700"];
const nfmt = (v) => (v == null || v === "" ? null : Number(v).toLocaleString("en-IN"));
function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

async function api(url, opts) {
  const r = await fetch(url, { cache: "no-store", ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || "Request failed");
  return data;
}

export default function Page() {
  return <SupervisorGuard><Body /></SupervisorGuard>;
}

function Body() {
  const [tab, setTab] = useState(() => {
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (TABS.some((x) => x.key === t)) return t;
    }
    return "overview";
  });
  const [assemblies, setAssemblies] = useState([]);
  const [asmLoading, setAsmLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [bundle, setBundle] = useState(null);
  const [loadingBundle, setLoadingBundle] = useState(false);
  const [bundleErr, setBundleErr] = useState("");
  const [notice, setNotice] = useState("");
  const [err, setErr] = useState("");
  const flash = (m) => { setNotice(m); setErr(""); };
  const fail = (m) => { setErr(m); setNotice(""); };
  useEffect(() => { if (notice || err) { const t = setTimeout(() => { setNotice(""); setErr(""); }, 3500); return () => clearTimeout(t); } }, [notice, err]);

  const loadAssemblies = useCallback(async () => {
    setAsmLoading(true);
    try {
      const d = await api("/api/leader-assessment/assemblies");
      setAssemblies(d.assemblies || []);
      setSelectedId((cur) => cur ?? (d.assemblies?.[0]?.id ?? null));
    } catch (e) { fail(e.message); } finally { setAsmLoading(false); }
  }, []);

  const loadBundle = useCallback(async (id) => {
    if (!id) { setBundle(null); return; }
    setLoadingBundle(true); setBundleErr("");
    try { setBundle(await api(`/api/leader-assessment/assemblies/${id}`)); }
    catch (e) { setBundleErr(e.message); setBundle(null); }
    finally { setLoadingBundle(false); }
  }, []);

  useEffect(() => { loadAssemblies(); }, [loadAssemblies]);
  useEffect(() => { loadBundle(selectedId); }, [selectedId, loadBundle]);

  const currentTab = TABS.find((t) => t.key === tab);
  const openAssembly = (id) => { setSelectedId(id); setTab("mla"); };

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      {notice && <Toast kind="ok">{notice}</Toast>}
      {err && <Toast kind="err">{err}</Toast>}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#164FA3]/10 text-[#164FA3] flex items-center justify-center"><UserSquare2 size={22} /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Leader Assessment</h1>
            <p className="text-sm text-gray-500">Assembly-wise MLA & AAP candidate assessment.</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 -mb-px overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3.5 py-2 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap flex items-center gap-1.5 ${tab === t.key ? "border-[#164FA3] text-[#164FA3]" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Assembly switcher (assembly-scoped tabs) */}
      {currentTab?.scoped && (
        <div className="flex items-center gap-3 flex-wrap bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
          <span className="text-sm font-semibold text-gray-600 flex items-center gap-1.5"><MapPin size={15} className="text-[#164FA3]" /> Select Assembly</span>
          <select value={selectedId || ""} onChange={(e) => setSelectedId(Number(e.target.value) || null)} className={`${inp} max-w-xs`}>
            <option value="">— choose —</option>
            {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}{a.district ? ` · ${a.district}` : ""}</option>)}
          </select>
          {loadingBundle && <Loader2 size={16} className="animate-spin text-[#164FA3]" />}
          {!asmLoading && !assemblies.length && <span className="text-sm text-gray-400">No assemblies yet — add one on the Assemblies tab.</span>}
        </div>
      )}

      {tab === "overview" && <Overview onOpen={openAssembly} />}

      {currentTab?.scoped && !selectedId && <Empty msg="Select an assembly above to begin." />}
      {currentTab?.scoped && selectedId && loadingBundle && !bundle && <LoadingBlock />}
      {currentTab?.scoped && selectedId && bundleErr && <ErrorBlock msg={bundleErr} onRetry={() => loadBundle(selectedId)} />}
      {currentTab?.scoped && selectedId && bundle && (
        <>
          <AssemblyHeader a={bundle.assembly} status={bundle.status} />
          {tab === "mla" && <MlaTab b={bundle} onSaved={() => { flash("MLA profile saved."); loadBundle(selectedId); }} fail={fail} />}
          {tab === "elections" && <ElectionsTab b={bundle} onChange={() => loadBundle(selectedId)} flash={flash} fail={fail} />}
          {tab === "candidates" && <CandidatesTab b={bundle} onChange={() => { loadBundle(selectedId); loadAssemblies(); }} flash={flash} fail={fail} />}
          {tab === "assessments" && <AssessmentsTab b={bundle} onChange={() => { loadBundle(selectedId); loadAssemblies(); }} flash={flash} fail={fail} />}
          {tab === "comparison" && <ComparisonTab b={bundle} onChange={() => loadBundle(selectedId)} flash={flash} fail={fail} />}
          {tab === "analysis" && <AnalysisTab b={bundle} onChange={() => loadBundle(selectedId)} flash={flash} fail={fail} />}
        </>
      )}
    </div>
  );
}

// --------------------------- shared primitives ----------------------------
function Toast({ kind, children }) {
  return <div className={`fixed top-4 right-4 z-[80] flex items-center gap-2 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg ${kind === "ok" ? "bg-emerald-600" : "bg-red-600"}`}>{kind === "ok" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}{children}</div>;
}
function Empty({ msg, action }) {
  return <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-10 text-center"><div className="text-gray-400 text-sm">{msg}</div>{action && <div className="mt-3">{action}</div>}</div>;
}
function LoadingBlock() {
  return <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 flex items-center justify-center text-gray-400"><Loader2 className="animate-spin mr-2" size={18} /> Loading…</div>;
}
function ErrorBlock({ msg, onRetry }) {
  return <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center"><div className="text-red-700 text-sm font-medium">{msg}</div><button onClick={onRetry} className="mt-2 text-sm font-semibold text-[#164FA3] hover:underline">Retry</button></div>;
}
function Card({ title, icon: Icon, children, right, sub }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      {(title || right) && (
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="font-bold text-gray-900 flex items-center gap-2">{Icon && <Icon size={17} className="text-[#164FA3]" />}{title}</h3>
            {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}
function Stat({ label, value, hint }) {
  const has = value != null && value !== "";
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className={`text-2xl font-bold ${has ? "text-gray-900" : "text-gray-300"}`}>{has ? value : "N/A"}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      {hint && <div className="text-[11px] text-gray-400 mt-0.5">{hint}</div>}
    </div>
  );
}
function ScoreBar({ value, max = 10, showValue = true }) {
  const v = Number(value) || 0;
  const pct = Math.max(0, Math.min(100, (v / max) * 100));
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-[#164FA3]" : "bg-amber-500";
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} /></div>
      {showValue && <span className="text-xs font-semibold text-gray-600 w-10 text-right">{value != null && value !== "" ? `${v}/${max}` : "—"}</span>}
    </div>
  );
}
function SaveBtn({ onClick, saving, label = "Save" }) {
  return <button onClick={onClick} disabled={saving} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white px-3.5 py-2 rounded-lg text-sm font-semibold">{saving ? <Loader2 size={14} className="animate-spin" /> : null} {label}</button>;
}
function ResultBadge({ v }) {
  if (!v) return <span className="text-gray-300">—</span>;
  const won = /won/i.test(v), lost = /lost/i.test(v);
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${won ? "bg-emerald-50 text-emerald-700" : lost ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-600"}`}>{v}</span>;
}
function AssemblyHeader({ a, status }) {
  const items = [
    ["Total Voters", nfmt(a.total_voters)], ["Polling Stations", a.total_polling_stations], ["Total Booths", a.total_booths],
    ["District", a.district], ["Lok Sabha", a.lok_sabha], ["Last Election", a.election_year],
  ];
  return (
    <div className="bg-gradient-to-br from-[#164FA3] to-[#0B3A82] rounded-2xl p-5 text-white shadow-sm">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-white/70 font-medium">विधानसभा</div>
          <h2 className="text-2xl font-bold">{a.name}</h2>
          <div className="text-sm text-white/85 flex items-center gap-2 mt-0.5"><MapPin size={13} /> {a.district || "—"}{a.number ? ` · Seat #${a.number}` : ""}</div>
        </div>
        <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${status.ready ? "bg-emerald-400/25 text-emerald-50" : "bg-white/15 text-white/90"}`}>
          {status.ready ? "● Assessment Ready" : "○ Assessment Incomplete"}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 mt-4">
        {items.map(([k, v]) => (
          <div key={k} className="bg-white/10 rounded-xl px-3 py-2">
            <div className="text-[11px] text-white/70">{k}</div>
            <div className="font-bold truncate">{v != null && v !== "" ? v : "N/A"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------- OVERVIEW ---------------------------------
function Overview({ onOpen }) {
  const [data, setData] = useState(null);
  const [assemblies, setAssemblies] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([
      api("/api/leader-assessment/overview").then(setData).catch(() => {}),
      api("/api/leader-assessment/assemblies").then((d) => setAssemblies(d.assemblies || [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);
  const s = data?.stats;
  if (loading) return <LoadingBlock />;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Total Assemblies" value={s?.total_assemblies} />
        <Stat label="With MLA Data" value={s?.assemblies_with_mla} />
        <Stat label="With AAP Candidates" value={s?.assemblies_with_candidates} />
        <Stat label="Total Candidates" value={s?.total_candidates} />
        <Stat label="Assessments Done" value={s?.assessments_completed} />
        <Stat label="Avg Candidate Score" value={s?.average_score != null ? `${s.average_score}/100` : null} />
      </div>

      {data?.top_candidates?.length > 0 && (
        <Card title="Top-Ranked Candidates" icon={Trophy}>
          <div className="space-y-2.5">
            {data.top_candidates.map((c, i) => (
              <div key={c.id} className="flex items-center gap-3">
                <span className={`w-6 text-center font-bold ${i < 3 ? RANK_COLOR[i] : "text-gray-400"}`}>{i + 1}</span>
                <div className="w-40 min-w-0"><div className="font-semibold text-gray-900 truncate text-sm">{c.name}</div><div className="text-xs text-gray-400 truncate">{c.assembly_name}</div></div>
                <div className="flex-1"><ScoreBar value={c.total} max={100} showValue={false} /></div>
                <span className="font-bold text-[#164FA3] w-16 text-right">{c.total}/100</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Assemblies" icon={Building2}>
        {assemblies.length === 0 ? <Empty msg="No assemblies yet. Add one on the Assemblies tab." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500"><tr>{["Assembly", "Current MLA", "Candidates", "Top Candidate", "Score", "Status", ""].map((h) => <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100">
                {assemblies.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5"><div className="font-semibold text-gray-900">{a.name}</div><div className="text-xs text-gray-400">{a.district || "—"}</div></td>
                    <td className="px-3 py-2.5 text-gray-700">{a.mla_name || <span className="text-gray-300">No MLA</span>}</td>
                    <td className="px-3 py-2.5"><span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{a.candidate_count}/3</span></td>
                    <td className="px-3 py-2.5 text-gray-700">{a.top_candidate || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2.5 font-semibold">{a.top_score != null ? `${a.top_score}/100` : <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2.5">{a.mla_name && a.candidate_count > 0 ? <span className="text-xs font-semibold text-emerald-700">In progress</span> : <span className="text-xs text-gray-400">Incomplete</span>}</td>
                    <td className="px-3 py-2.5 text-right"><button onClick={() => onOpen(a.id)} className="text-[#164FA3] font-semibold hover:underline text-xs">Open →</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// -------------------------------- MLA -------------------------------------
const EMPTY_MLA = { photo_url: "", name: "", phone: "", address: "", date_of_birth: "", caste: "", party: "", net_worth: "", criminal_cases: "", times_won: "", times_contested: "", largest_winning_margin: "", previous_winning_margin: "", party_won_from: "", party_defeated: "" };
function mlaMetrics(b) {
  const el = b.elections || [];
  const mla = b.mla || {};
  const wins = mla.times_won != null ? Number(mla.times_won) : el.filter((e) => /won/i.test(e.result || "")).length;
  const contested = mla.times_contested != null ? Number(mla.times_contested) : el.length;
  const winRate = contested > 0 ? Math.round((wins / contested) * 100) : null;
  const wonMargins = el.filter((e) => /won/i.test(e.result || "") && e.margin != null).map((e) => Number(e.margin));
  const best = mla.largest_winning_margin != null ? Number(mla.largest_winning_margin) : (wonMargins.length ? Math.max(...wonMargins) : null);
  const latest = el[0];
  const lastMargin = mla.previous_winning_margin != null ? Number(mla.previous_winning_margin) : (latest?.margin ?? null);
  return { wins, contested, winRate, best, lastMargin, latestVotes: latest?.votes ?? null, latestShare: latest?.vote_percentage ?? null };
}
function MlaTab({ b, onSaved, fail }) {
  const seed = () => ({ ...EMPTY_MLA, ...(b.mla || {}), date_of_birth: b.mla?.date_of_birth ? String(b.mla.date_of_birth).slice(0, 10) : "" });
  const [form, setForm] = useState(seed);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm(seed()); /* eslint-disable-next-line */ }, [b.assembly.id, b.mla]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const age = ageOf(form.date_of_birth);
  const m = mlaMetrics(b);
  async function persistPhoto(blob) {
    if (!blob) return null;
    const fd = new FormData(); fd.append("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
    const up = await fetch("/api/uploads", { method: "POST", body: fd }); const d = await up.json().catch(() => ({}));
    if (!up.ok) throw new Error(d.message || "Upload failed"); return d.url;
  }
  async function save() {
    setSaving(true);
    try { await api(`/api/leader-assessment/assemblies/${b.assembly.id}/mla`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }); onSaved(); }
    catch (e) { fail(e.message); } finally { setSaving(false); }
  }
  const F = ({ k, label, type = "text", full }) => (<div className={full ? "col-span-2" : ""}><span className={lbl}>{label}</span><input type={type} className={inp} value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} /></div>);
  return (
    <div className="space-y-4">
      <Card title="Current MLA Profile" icon={UserSquare2} right={<SaveBtn onClick={save} saving={saving} label="Save MLA" />}>
        <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6">
          <div className="flex flex-col items-center gap-1.5">
            <ProfilePhoto name={form.name} src={form.photo_url} size={120} square editable persist={persistPhoto} onChange={(url) => set("photo_url", url || "")} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3]" />
            <span className="text-[11px] text-gray-400">JPG, PNG, WEBP</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <F k="name" label="Full Name" full />
            <F k="phone" label="Phone" /><F k="party" label="Party" />
            <F k="date_of_birth" label="Date of Birth" type="date" />
            <div><span className={lbl}>Age (auto)</span><div className={`${inp} bg-gray-50 text-gray-600 font-semibold`}>{age != null ? `${age} years` : "Age not available"}</div></div>
            <F k="caste" label="Caste" /><F k="net_worth" label="Net Worth" />
            <F k="criminal_cases" label="Criminal Cases" type="number" />
            <F k="address" label="Address" full />
          </div>
        </div>
      </Card>

      <Card title="Election Performance" icon={TrendingUp}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat label="Wins" value={m.wins} />
          <Stat label="Contested" value={m.contested} />
          <Stat label="Win Rate" value={m.winRate != null ? `${m.winRate}%` : null} />
          <Stat label="Best Margin" value={nfmt(m.best)} />
          <Stat label="Last Margin" value={nfmt(m.lastMargin)} />
          <Stat label="Latest Votes" value={nfmt(m.latestVotes)} hint={m.latestShare != null ? `${m.latestShare}% share` : null} />
        </div>
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className={lbl}>Edit performance details</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <F k="times_won" label="Times Won" type="number" /><F k="times_contested" label="Times Contested" type="number" />
            <F k="largest_winning_margin" label="Largest Margin" type="number" /><F k="previous_winning_margin" label="Previous Margin" type="number" />
            <F k="party_won_from" label="Party Won From" /><F k="party_defeated" label="Party Defeated" />
          </div>
          <div className="mt-3 flex justify-end"><SaveBtn onClick={save} saving={saving} label="Save Performance" /></div>
        </div>
      </Card>
    </div>
  );
}

// ----------------------------- ELECTIONS ----------------------------------
const EMPTY_ELEC = { election_year: "", election_type: "", party: "", candidate: "", status: "", votes: "", vote_percentage: "", margin: "", result: "", runner_up: "", runner_up_votes: "" };
function ElectionsTab({ b, onChange, flash, fail }) {
  const [editing, setEditing] = useState(null);
  async function del(e) {
    if (!confirm("Remove this election record?")) return;
    try { await api(`/api/leader-assessment/elections/${e.id}`, { method: "DELETE" }); flash("Election removed."); onChange(); } catch (er) { fail(er.message); }
  }
  const last10 = b.elections.slice(0, 10);
  return (
    <Card title="Assembly Election History" icon={History} sub={b.elections.length > 10 ? `Showing the latest 10 of ${b.elections.length} records (newest first).` : "Newest first."} right={<button onClick={() => setEditing("new")} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-3 py-2 rounded-lg text-sm font-semibold"><Plus size={15} /> Add Election</button>}>
      {b.elections.length === 0 ? <Empty msg="No election records yet." action={<button onClick={() => setEditing("new")} className="inline-flex items-center gap-1.5 bg-[#164FA3] text-white px-3 py-2 rounded-lg text-sm font-semibold"><Plus size={15} /> Add Election</button>} /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500"><tr>{["Year", "Party", "Candidate", "Votes", "Vote %", "Margin", "Result", "Runner-up", ""].map((h) => <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {last10.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2.5 font-semibold">{e.election_year}</td>
                  <td className="px-3 py-2.5">{e.party || "—"}</td>
                  <td className="px-3 py-2.5">{e.candidate || "—"}</td>
                  <td className="px-3 py-2.5">{nfmt(e.votes) || "—"}</td>
                  <td className="px-3 py-2.5">{e.vote_percentage != null ? `${e.vote_percentage}%` : "—"}</td>
                  <td className="px-3 py-2.5">{nfmt(e.margin) || "—"}</td>
                  <td className="px-3 py-2.5"><ResultBadge v={e.result || e.status} /></td>
                  <td className="px-3 py-2.5 text-gray-600">{e.runner_up || "—"}{e.runner_up_votes != null ? ` (${nfmt(e.runner_up_votes)})` : ""}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(e)} className="text-gray-500 hover:text-[#164FA3] p-1"><Pencil size={14} /></button>
                    <button onClick={() => del(e)} className="text-gray-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ElectionModal assemblyId={b.assembly.id} initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); flash("Election saved."); onChange(); }} fail={fail} />}
    </Card>
  );
}
function ElectionModal({ assemblyId, initial, onClose, onSaved, fail }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_ELEC, ...(initial || {}) }));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  async function save() {
    if (!String(form.election_year).trim()) { fail("Election year is required."); return; }
    const yr = Number(form.election_year);
    if (!Number.isInteger(yr) || yr < 1900 || yr > 2100) { fail("Enter a valid election year."); return; }
    setSaving(true);
    try {
      const url = initial ? `/api/leader-assessment/elections/${initial.id}` : `/api/leader-assessment/assemblies/${assemblyId}/elections`;
      await api(url, { method: initial ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      onSaved();
    } catch (e) { fail(e.message); setSaving(false); }
  }
  const F = ({ k, label, type = "text" }) => (<div><span className={lbl}>{label}</span><input type={type} className={inp} value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} /></div>);
  return (
    <Modal title={initial ? "Edit Election" : "Add Election"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <F k="election_year" label="Election Year *" type="number" /><F k="election_type" label="Election Type" />
        <F k="party" label="Winning Party" /><F k="candidate" label="Winner / Candidate" />
        <div><span className={lbl}>Result</span><select className={inp} value={form.result || ""} onChange={(e) => set("result", e.target.value)}><option value="">—</option><option value="Won">Won</option><option value="Lost">Lost</option></select></div>
        <F k="votes" label="Votes" type="number" />
        <F k="vote_percentage" label="Vote %" type="number" /><F k="margin" label="Margin" type="number" />
        <F k="runner_up" label="Runner-up" /><F k="runner_up_votes" label="Runner-up Votes" type="number" />
      </div>
      <ModalActions onClose={onClose} onSave={save} saving={saving} />
    </Modal>
  );
}

// ----------------------------- CANDIDATES ---------------------------------
const EMPTY_CAND = { photo_url: "", name: "", phone: "", address: "", date_of_birth: "", caste: "", net_worth: "", business: "", monthly_income: "", education: "", political_experience: "", organization_experience: "", previous_elections: "", current_position: "" };
function CandidatesTab({ b, onChange, flash, fail }) {
  const [editing, setEditing] = useState(null);
  async function del(c) {
    if (!confirm(`Remove candidate "${c.name}"?`)) return;
    try { await api(`/api/leader-assessment/candidates/${c.id}`, { method: "DELETE" }); flash("Candidate removed."); onChange(); } catch (e) { fail(e.message); }
  }
  const slots = [0, 1, 2];
  return (
    <Card title="AAP Candidate Comparison" icon={Users} sub="Up to 3 candidates per assembly.">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {slots.map((i) => {
          const c = b.candidates[i];
          if (!c) return (
            <button key={i} onClick={() => setEditing("new")} disabled={b.candidates.length >= 3} className="border-2 border-dashed border-gray-200 rounded-2xl p-8 flex flex-col items-center justify-center text-gray-400 hover:border-[#164FA3] hover:text-[#164FA3] disabled:opacity-40 disabled:cursor-not-allowed">
              <Plus size={22} /><span className="text-sm font-semibold mt-1">Add Candidate</span><span className="text-[11px]">Slot {i + 1}</span>
            </button>
          );
          return (
            <div key={c.id} className="border border-gray-100 rounded-2xl p-4 relative">
              {c.rank && c.total > 0 && <span className={`absolute top-3 right-3 text-[11px] font-bold px-2 py-0.5 rounded-full ${c.rank === 1 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>Rank {c.rank}{c.tied ? " (tie)" : ""}</span>}
              <div className="flex items-center gap-3">
                <ProfilePhoto name={c.name} src={c.photo_url} size={56} editable={false} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3]" />
                <div className="min-w-0"><div className="font-bold text-gray-900 truncate">{c.name}</div><div className="text-xs text-gray-500">{c.age != null ? `${c.age} yrs` : "Age N/A"}{c.caste ? ` · ${c.caste}` : ""}</div></div>
              </div>
              <div className="mt-3 flex items-center gap-2"><ScoreBar value={c.total} max={100} showValue={false} /><span className="text-sm font-bold text-[#164FA3]">{c.total}/100</span></div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3 text-xs">
                <Kv icon={Phone} k="Phone" v={c.phone} /><Kv icon={Wallet} k="Net Worth" v={c.net_worth} />
                <Kv k="Business" v={c.business} /><Kv k="Income" v={c.monthly_income} />
                {c.education && <Kv k="Education" v={c.education} />}
                {c.current_position && <Kv k="Position" v={c.current_position} />}
              </div>
              <div className="flex justify-end gap-1 mt-3 pt-3 border-t border-gray-100">
                <button onClick={() => setEditing(c)} className="text-xs font-semibold text-gray-500 hover:text-[#164FA3] px-2 py-1 rounded-lg inline-flex items-center gap-1"><Pencil size={13} /> Edit</button>
                <button onClick={() => del(c)} className="text-xs font-semibold text-gray-400 hover:text-red-600 px-2 py-1 rounded-lg inline-flex items-center gap-1"><Trash2 size={13} /> Remove</button>
              </div>
            </div>
          );
        })}
      </div>
      {editing && <CandidateModal assemblyId={b.assembly.id} initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); flash("Candidate saved."); onChange(); }} fail={fail} />}
    </Card>
  );
}
function Kv({ icon: Icon, k, v }) { return <div className="flex items-center gap-1 min-w-0"><span className="text-gray-400 shrink-0">{Icon && <Icon size={11} className="inline mr-0.5" />}{k}:</span> <span className="text-gray-700 font-medium truncate">{v || "—"}</span></div>; }
function CandidateModal({ assemblyId, initial, onClose, onSaved, fail }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_CAND, ...(initial || {}), date_of_birth: initial?.date_of_birth ? String(initial.date_of_birth).slice(0, 10) : "" }));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const age = ageOf(form.date_of_birth);
  async function persistPhoto(blob) {
    if (!blob) return null;
    const fd = new FormData(); fd.append("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
    const up = await fetch("/api/uploads", { method: "POST", body: fd }); const d = await up.json().catch(() => ({}));
    if (!up.ok) throw new Error(d.message || "Upload failed"); return d.url;
  }
  async function save() {
    if (!form.name.trim()) { fail("Candidate name is required."); return; }
    setSaving(true);
    try {
      const url = initial ? `/api/leader-assessment/candidates/${initial.id}` : `/api/leader-assessment/assemblies/${assemblyId}/candidates`;
      await api(url, { method: initial ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      onSaved();
    } catch (e) { fail(e.message); setSaving(false); }
  }
  const F = ({ k, label, type = "text", full }) => (<div className={full ? "col-span-2" : ""}><span className={lbl}>{label}</span><input type={type} className={inp} value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} /></div>);
  return (
    <Modal title={initial ? "Edit Candidate" : "Add AAP Candidate"} onClose={onClose}>
      <div className="flex flex-col items-center gap-1.5 pb-2">
        <ProfilePhoto name={form.name} src={form.photo_url} size={88} square editable persist={persistPhoto} onChange={(url) => set("photo_url", url || "")} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3]" />
        <span className="text-[11px] text-gray-400">JPG, PNG, WEBP</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <F k="name" label="Full Name *" full />
        <F k="phone" label="Phone" /><F k="date_of_birth" label="Date of Birth" type="date" />
        <div><span className={lbl}>Age (auto)</span><div className={`${inp} bg-gray-50 text-gray-600`}>{age != null ? `${age} years` : "Age not available"}</div></div>
        <F k="caste" label="Caste" />
        <F k="net_worth" label="Net Worth" /><F k="business" label="Business" />
        <F k="monthly_income" label="Monthly Income" /><F k="education" label="Education" />
        <F k="current_position" label="Current Position" /><F k="political_experience" label="Political Experience" />
        <F k="organization_experience" label="Organization Experience" /><F k="previous_elections" label="Previous Elections" />
        <F k="address" label="Address" full />
      </div>
      <ModalActions onClose={onClose} onSave={save} saving={saving} />
    </Modal>
  );
}

// ---------------------------- ASSESSMENTS ---------------------------------
function AssessmentsTab({ b, onChange, flash, fail }) {
  if (b.candidates.length === 0) return <Empty msg="No AAP candidates yet. Add candidates on the AAP Candidates tab first." />;
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{b.candidates.map((c) => <AssessCard key={c.id} c={c} onChange={onChange} flash={flash} fail={fail} />)}</div>;
}
function AssessCard({ c, onChange, flash, fail }) {
  const [scores, setScores] = useState(() => Object.fromEntries(PARAMS.map((p) => [p.key, c.assessment?.[p.key] ?? ""])));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setScores(Object.fromEntries(PARAMS.map((p) => [p.key, c.assessment?.[p.key] ?? ""]))); }, [c.id, c.assessment]);
  const total = PARAMS.reduce((s, p) => s + (Number(scores[p.key]) || 0), 0);
  function setScore(k, v) {
    if (v === "") return setScores((s) => ({ ...s, [k]: "" }));
    let n = Math.floor(Number(v)); if (isNaN(n)) return; n = Math.max(0, Math.min(10, n));
    setScores((s) => ({ ...s, [k]: n }));
  }
  async function save() {
    setSaving(true);
    try { await api(`/api/leader-assessment/candidates/${c.id}/assessment`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scores) }); flash(`Assessment saved for ${c.name}.`); onChange(); }
    catch (e) { fail(e.message); } finally { setSaving(false); }
  }
  return (
    <Card title={c.name} icon={ClipboardCheck} right={<div className="flex items-center gap-3"><span className={`text-lg font-bold ${total >= 70 ? "text-emerald-600" : "text-[#164FA3]"}`}>{total}/100</span><SaveBtn onClick={save} saving={saving} /></div>}>
      <div className="space-y-2">
        {PARAMS.map((p) => (
          <div key={p.key} className="flex items-center gap-3">
            <span className="text-sm text-gray-700 w-40 shrink-0">{p.label}</span>
            <ScoreBar value={scores[p.key]} />
            <input type="number" min={0} max={10} value={scores[p.key]} onChange={(e) => setScore(p.key, e.target.value)} className="w-14 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center outline-none focus:ring-2 focus:ring-[#164FA3]/40 shrink-0" />
          </div>
        ))}
      </div>
      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">TOTAL</span>
        <span className="text-xl font-bold text-[#164FA3]">{total} / 100</span>
      </div>
    </Card>
  );
}

// ----------------------------- COMPARISON ---------------------------------
function ComparisonTab({ b, onChange, flash, fail }) {
  const ranked = b.candidates;
  if (ranked.length === 0) return <Empty msg="No AAP candidates to compare yet. Add candidates and score them first." />;
  const maxOf = (key) => Math.max(...ranked.map((c) => Number(c.assessment?.[key]) || 0));
  const maxTotal = Math.max(...ranked.map((c) => c.total));
  return (
    <div className="space-y-4">
      <Card title="Candidate Comparison" icon={BarChart3} sub="Highest score in each row is highlighted.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="px-3 py-2 text-left font-semibold text-gray-500">Parameter</th>{ranked.map((c) => <th key={c.id} className="px-3 py-2 text-center font-semibold text-gray-900 min-w-[110px]">{c.name}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {PARAMS.map((p) => { const mx = maxOf(p.key); return (
                <tr key={p.key}>
                  <td className="px-3 py-2 text-gray-600">{p.label}</td>
                  {ranked.map((c) => { const v = c.assessment?.[p.key]; const hi = v != null && Number(v) === mx && mx > 0; return <td key={c.id} className={`px-3 py-2 text-center ${hi ? "bg-emerald-50 font-bold text-emerald-700" : ""}`}>{v ?? "—"}</td>; })}
                </tr>
              ); })}
              <tr className="bg-gray-50 font-bold">
                <td className="px-3 py-2.5 text-gray-900">TOTAL / 100</td>
                {ranked.map((c) => { const hi = c.total === maxTotal && maxTotal > 0; return <td key={c.id} className={`px-3 py-2.5 text-center ${hi ? "bg-amber-100 text-amber-800" : "text-[#164FA3]"}`}>{c.total}</td>; })}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Automatic Ranking" icon={Trophy} sub="Ranking is computed from total score. Tie-breaker: Winning Ability → Public Acceptability → earliest added.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {ranked.map((c, i) => {
            const Icon = RANK_ICON[c.rank - 1] || Award;
            return (
              <div key={c.id} className={`rounded-2xl border p-4 text-center ${c.rank === 1 && c.total > 0 ? "border-[#FCB712] bg-amber-50" : "border-gray-100"}`}>
                <Icon size={26} className={`mx-auto ${RANK_COLOR[c.rank - 1] || "text-gray-400"}`} />
                <div className="text-xs font-bold text-gray-400 mt-1">Rank {c.rank}{c.tied ? " (tie)" : ""}</div>
                <div className="font-bold text-gray-900 truncate">{c.name}</div>
                <div className="text-lg font-bold text-[#164FA3]">{c.total}/100</div>
              </div>
            );
          })}
        </div>
      </Card>

      <MlaVsAap b={b} ranked={ranked} />
      <Recommendation b={b} ranked={ranked} onChange={onChange} flash={flash} fail={fail} />
    </div>
  );
}

function MlaVsAap({ b, ranked }) {
  const mla = b.mla || {};
  const m = mlaMetrics(b);
  const rows = [
    { label: "Age", mla: mla.age != null ? `${mla.age}` : null, get: (c) => (c.age != null ? `${c.age}` : null) },
    { label: "Election Wins", mla: m.wins != null ? `${m.wins}` : null, get: () => null },
    { label: "Public Reach", mla: null, get: (c) => c.assessment?.s_public_reach },
    { label: "Social Reach", mla: null, get: (c) => c.assessment?.s_social_reach },
    { label: "Organization", mla: null, get: (c) => c.assessment?.s_organization },
    { label: "Winning Ability", mla: null, get: (c) => c.assessment?.s_winning },
    { label: "Overall Score", mla: null, get: (c) => `${c.total}/100`, bold: true },
  ];
  return (
    <Card title="Current MLA vs AAP Candidates" icon={Scale} sub="Only fields with real data are compared — MLA assessment scores are not fabricated.">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr><th className="px-3 py-2 text-left font-semibold text-gray-500">Metric</th><th className="px-3 py-2 text-center font-semibold text-gray-900 bg-blue-50">MLA {mla.name ? `· ${mla.name}` : ""}</th>{ranked.map((c) => <th key={c.id} className="px-3 py-2 text-center font-semibold text-gray-900">{c.name}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.label} className={r.bold ? "font-bold bg-gray-50" : ""}>
                <td className="px-3 py-2 text-gray-600">{r.label}</td>
                <td className="px-3 py-2 text-center bg-blue-50/50">{r.mla ?? "—"}</td>
                {ranked.map((c) => <td key={c.id} className="px-3 py-2 text-center">{r.get(c) ?? "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Recommendation({ b, ranked, onChange, flash, fail }) {
  const strongest = ranked.find((c) => c.rank === 1 && c.total > 0);
  const seed = () => ({ mla_biggest_weakness: "", aap_biggest_strength: "", target_community: "", target_booth: "", main_issue: "", ...(b.strategy || {}) });
  const [form, setForm] = useState(seed);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm(seed()); /* eslint-disable-next-line */ }, [b.assembly.id, b.strategy]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  async function save() {
    setSaving(true);
    try { await api(`/api/leader-assessment/assemblies/${b.assembly.id}/strategy`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }); flash("Recommendation saved."); onChange(); }
    catch (e) { fail(e.message); } finally { setSaving(false); }
  }
  const strengths = strongest ? PARAMS.map((p) => ({ label: p.label, v: Number(strongest.assessment?.[p.key]) || 0 })).sort((a, b2) => b2.v - a.v).slice(0, 3).filter((x) => x.v > 0) : [];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card title="Final Recommendation" icon={Star}>
        {strongest ? (
          <>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
              <Trophy size={22} className="text-[#FCB712]" />
              <div><div className="text-xs text-emerald-700 font-semibold">Recommended Candidate (auto-selected)</div><div className="font-bold text-gray-900 text-lg">{strongest.name}</div><div className="text-sm text-gray-600">Rank {strongest.rank} · {strongest.total}/100</div></div>
            </div>
            {strengths.length > 0 && (
              <div className="mt-3">
                <div className={lbl}>Why this candidate ranks highest</div>
                <ul className="space-y-1">{strengths.map((s) => <li key={s.label} className="text-sm text-gray-700 flex items-center gap-2"><CheckCircle2 size={14} className="text-emerald-500" /> Strong {s.label} ({s.v}/10)</li>)}</ul>
              </div>
            )}
          </>
        ) : <Empty msg="Assessment not completed — no recommended candidate yet." />}
      </Card>
      <Card title="Election Strategy" icon={Target} right={<SaveBtn onClick={save} saving={saving} />}>
        <div className="space-y-3">
          <div><span className={lbl}><ShieldAlert size={12} className="inline mr-1" />MLA's Major Weakness</span><textarea rows={2} className={inp} value={form.mla_biggest_weakness ?? ""} onChange={(e) => set("mla_biggest_weakness", e.target.value)} /></div>
          <div><span className={lbl}><Star size={12} className="inline mr-1" />AAP Candidate's Major Strength</span><textarea rows={2} className={inp} value={form.aap_biggest_strength ?? ""} onChange={(e) => set("aap_biggest_strength", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><span className={lbl}>Key Community / Group</span><input className={inp} value={form.target_community ?? ""} onChange={(e) => set("target_community", e.target.value)} /></div>
            <div><span className={lbl}>Target Booth</span><input className={inp} value={form.target_booth ?? ""} onChange={(e) => set("target_booth", e.target.value)} /></div>
          </div>
          <div><span className={lbl}><Vote size={12} className="inline mr-1" />Main Election Issue</span><textarea rows={2} className={inp} value={form.main_issue ?? ""} onChange={(e) => set("main_issue", e.target.value)} /></div>
        </div>
      </Card>
    </div>
  );
}

// ----------------------------- ANALYSIS -----------------------------------
// Current MLA for the selected assembly — auto-identified from that assembly's
// MLA record (b.mla, part of the assembly bundle). It is always scoped to the
// selected assembly, so switching assemblies immediately updates it and it can
// never show another assembly's MLA. No manual typing: the name is read from
// the stored MLA. When the assembly has no MLA record yet, a clean
// "Current MLA not available" state is shown.
function CurrentMlaBanner({ b }) {
  const mla = b.mla;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
      {mla?.name ? (
        <>
          <ProfilePhoto name={mla.name} src={mla.photo_url} size={44} editable={false} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3]" />
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Current MLA · {b.assembly.name}</div>
            <div className="font-bold text-gray-900 truncate flex items-center gap-2">
              {mla.name}
              {mla.party && <span className="text-xs font-semibold text-[#164FA3] bg-[#164FA3]/10 px-2 py-0.5 rounded-full">{mla.party}</span>}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="w-11 h-11 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 shrink-0"><UserSquare2 size={20} /></div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Current MLA · {b.assembly.name}</div>
            <div className="text-sm font-medium text-gray-400">Current MLA not available — add it on the MLA Profile tab.</div>
          </div>
        </>
      )}
    </div>
  );
}
function AnalysisTab({ b, onChange, flash, fail }) {
  const [reasons, setReasons] = useState(() => padTo(b.analysis?.reasons_won, 3));
  const [weaknesses, setWeaknesses] = useState(() => padTo(b.analysis?.weaknesses, 10));
  const [strengths, setStrengths] = useState(() => padTo(b.analysis?.strengths, 5));
  const [social, setSocial] = useState(() => seedSocial(b.social));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setReasons(padTo(b.analysis?.reasons_won, 3)); setWeaknesses(padTo(b.analysis?.weaknesses, 10)); setStrengths(padTo(b.analysis?.strengths, 5)); setSocial(seedSocial(b.social));
  }, [b.assembly.id, b.analysis, b.social]);
  async function saveAnalysis() {
    setSaving(true);
    try { await api(`/api/leader-assessment/assemblies/${b.assembly.id}/analysis`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reasons_won: reasons, weaknesses, strengths }) }); flash("Political analysis saved."); onChange(); }
    catch (e) { fail(e.message); } finally { setSaving(false); }
  }
  async function saveSocial() {
    try { await api(`/api/leader-assessment/assemblies/${b.assembly.id}/social`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: social }) }); flash("Social profile saved."); onChange(); }
    catch (e) { fail(e.message); }
  }
  const numbered = (title, items, setItems, accent) => (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">{title}</div>
      <div className="space-y-2">
        {items.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className={`text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${accent}`}>{i + 1}</span>
            <input className={inp} value={v} onChange={(e) => setItems((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))} />
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div className="space-y-4">
      <CurrentMlaBanner b={b} />
      <Card title="Political Analysis" icon={Brain} right={<SaveBtn onClick={saveAnalysis} saving={saving} />}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {numbered("Top 3 Reasons for Winning", reasons, setReasons, "bg-emerald-100 text-emerald-700")}
          {numbered("Top 5 Strengths", strengths, setStrengths, "bg-[#164FA3]/10 text-[#164FA3]")}
          {numbered("Top 10 Weaknesses", weaknesses, setWeaknesses, "bg-red-100 text-red-600")}
        </div>
      </Card>
      <Card title="Assembly Social Profile" icon={Users} sub="Top castes / communities — admin-entered. Percentages are not invented." right={<SaveBtn onClick={saveSocial} />}>
        <div className="space-y-3">
          {social.map((row, i) => {
            const pct = Number(row.percentage) || 0;
            return (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs font-bold text-gray-400 w-14 shrink-0">Rank {i + 1}</span>
                <input className={`${inp} max-w-xs`} placeholder="Community / Caste" value={row.name} onChange={(e) => setSocial((a) => a.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <div className="flex-1 hidden sm:block"><div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-[#164FA3] rounded-full" style={{ width: `${Math.min(100, pct)}%` }} /></div></div>
                <div className="relative shrink-0"><input type="number" className={`${inp} w-24 pr-6`} placeholder="%" value={row.percentage} onChange={(e) => setSocial((a) => a.map((x, j) => (j === i ? { ...x, percentage: e.target.value } : x)))} /><span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">%</span></div>
                <button onClick={() => setSocial((a) => a.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600 p-1.5 shrink-0"><X size={14} /></button>
              </div>
            );
          })}
        </div>
        <button onClick={() => setSocial((a) => [...a, { name: "", percentage: "" }])} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[#164FA3] hover:underline"><Plus size={14} /> Add community</button>
      </Card>
    </div>
  );
}

// ------------------------------- helpers ----------------------------------
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-4"><h2 className="text-xl font-bold text-gray-900">{title}</h2><button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button></div>
        {children}
      </div>
    </div>
  );
}
function ModalActions({ onClose, onSave, saving }) {
  return (
    <div className="flex justify-end gap-2 pt-4">
      <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
      <button onClick={onSave} disabled={saving} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold inline-flex items-center gap-2">{saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : "Save"}</button>
    </div>
  );
}
function padTo(arr, n) { const a = Array.isArray(arr) ? [...arr] : []; while (a.length < n) a.push(""); return a.slice(0, n); }
function seedSocial(social) { return social?.length ? social.map((s) => ({ name: s.name, percentage: s.percentage ?? "" })) : [{ name: "", percentage: "" }, { name: "", percentage: "" }, { name: "", percentage: "" }]; }
function ageOf(dob) {
  if (!dob) return null; const d = new Date(dob); if (isNaN(d.getTime())) return null;
  const now = new Date(); let age = now.getFullYear() - d.getFullYear(); const mo = now.getMonth() - d.getMonth();
  if (mo < 0 || (mo === 0 && now.getDate() < d.getDate())) age--; return age >= 0 && age < 130 ? age : null;
}
