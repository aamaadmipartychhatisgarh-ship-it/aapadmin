"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import ProfilePhoto from "@/components/ProfilePhoto";
import { initialsOf } from "@/components/Avatar";
import {
  LayoutDashboard, Building2, UserSquare2, Users, ClipboardCheck,
  BarChart3, Brain, Plus, Pencil, Trash2, X, Loader2, Trophy, Medal, Award,
  CheckCircle2, AlertCircle, MapPin, Phone, Calendar, Wallet,
  Target, ShieldAlert, Star, Vote, Search, ChevronDown, ChevronUp,
  Database, Power, Check,
} from "lucide-react";

// 10 assessment parameters (keys match the DB columns / API). Each is scored /10
// → a 100-point total.
const PARAMS = [
  { key: "s_nature", label: "Candidate Nature" },
  { key: "s_hardworker", label: "Hard Worker" },
  { key: "s_financial", label: "Financial Condition" },
  { key: "s_political", label: "Political Knowledge" },
  { key: "s_public_reach", label: "Public Reach / Pakad" },
  { key: "s_social_reach", label: "Social / Samajik Reach" },
  { key: "s_personality", label: "Personality" },
  { key: "s_organization", label: "Organizational Strength / Sangathan Mein Pakad" },
  { key: "s_winning", label: "Election Winning Ability" },
  { key: "s_acceptability", label: "Public Acceptability" },
];
// Scores are whole numbers 1–10 (10 params → max 100). 0/blank means "not yet
// scored" and is allowed; a real score is clamped into 1..10.
const SCORE_MIN = 1;
const SCORE_MAX = 10;

const TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, scoped: false },
  { key: "mla", label: "MLA Profile", icon: UserSquare2, scoped: false },
  { key: "candidates", label: "AAP Candidates", icon: Users, scoped: false },
  // Centralized Caste / Community master — the single source of truth for every
  // Caste/Community value used across the module (Assembly Social Profile · Add
  // Community). Not assembly-scoped.
  { key: "castes", label: "Caste Master", icon: Database, scoped: false },
  // Assembly-wise polling / electorate master (booths, voters, male, female).
  { key: "polling", label: "Polling Station Master", icon: Building2, scoped: false },
  // The standalone "Political Analysis" tab was removed — its full functionality
  // (Top Reasons / Strengths / Weaknesses + Assembly Social Profile) lives in the
  // Full View modal (AssemblyFullView → AnalysisTab). Nothing was deleted.
];

const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-[#164FA3]/40";
const lbl = "block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1";

// Labeled text input for the Leader Assessment forms. Defined at MODULE level so
// its component identity is STABLE across renders. The previous helper was
// declared inside each form component (`const F = …`), so every keystroke made a
// brand-new component type → React remounted the <input> → focus was lost after
// one character. Value/onChange are passed in (controlled) so the element itself
// is reconciled in place, preserving focus and cursor position.
function Field({ label, type = "text", full, value, onChange, error }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <span className={lbl}>{label}</span>
      <input type={type} className={`${inp} ${error ? "border-red-400 focus:ring-red-200" : ""}`} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      {error && <span className="text-[11px] text-red-500 mt-0.5 block">{error}</span>}
    </div>
  );
}
// Passport-ratio (3:4 portrait) profile photo used for the MLA and every
// candidate in the Full View. Reuses the shared initials/placeholder logic so a
// missing photo shows a clean placeholder (never a broken image); object-cover
// keeps the aspect ratio without stretching or distorting the image. `w` is the
// width in px; height is derived to keep a consistent passport ratio everywhere.
function PassportPhoto({ name, src, w = 64, className = "" }) {
  const h = Math.round((w * 4) / 3);
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [src]);
  const ini = initialsOf(name);
  const showImg = src && !errored;
  return (
    <div style={{ width: w, height: h }} className={`rounded-lg overflow-hidden border border-gray-200 bg-[#164FA3]/10 flex items-center justify-center shrink-0 ${className}`}>
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name || "photo"} loading="lazy" decoding="async" onError={() => setErrored(true)} className="w-full h-full object-cover" />
      ) : ini ? (
        <span className="font-bold text-[#164FA3] leading-none" style={{ fontSize: Math.round(w * 0.4) }}>{ini}</span>
      ) : (
        <UserSquare2 size={Math.round(w * 0.5)} className="text-[#164FA3]" />
      )}
    </div>
  );
}

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
  const [notice, setNotice] = useState("");
  const [err, setErr] = useState("");
  const flash = (m) => { setNotice(m); setErr(""); };
  const fail = (m) => { setErr(m); setNotice(""); };
  useEffect(() => { if (notice || err) { const t = setTimeout(() => { setNotice(""); setErr(""); }, 3500); return () => clearTimeout(t); } }, [notice, err]);

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

      {tab === "overview" && <Overview flash={flash} fail={fail} />}
      {tab === "mla" && <MlaManager flash={flash} fail={fail} />}
      {tab === "candidates" && <CandidatesTab flash={flash} fail={fail} />}
      {tab === "castes" && <CasteMaster flash={flash} fail={fail} />}
      {tab === "polling" && <PollingMaster flash={flash} fail={fail} />}
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
function AssemblyHeader({ a, status }) {
  const items = [
    ["Total Voters", nfmt(a.total_voters)], ["Male Voters", nfmt(a.male_voters)], ["Female Voters", nfmt(a.female_voters)],
    ["Total Booths", nfmt(a.total_booths)], ["Polling Stations", a.total_polling_stations], ["District", a.district],
    ["Lok Sabha", a.lok_sabha], ["Last Election", a.election_year],
  ];
  return (
    <div className="bg-gradient-to-br from-[#164FA3] to-[#0B3A82] rounded-2xl p-5 text-white shadow-sm">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-white/70 font-medium">विधानसभा</div>
          <h2 className="text-2xl font-bold">{a.name}</h2>
          <div className="text-sm text-white/85 flex items-center gap-2 mt-0.5"><MapPin size={13} /> {a.district || "—"}{a.number ? ` · Seat #${a.number}` : ""}</div>
        </div>
        <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${status.completed ? "bg-emerald-400/25 text-emerald-50" : "bg-white/15 text-white/90"}`}>
          {status.completed ? "● Completed" : "○ Pending"}
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
function Overview({ flash, fail }) {
  const [data, setData] = useState(null);
  const [assemblies, setAssemblies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pickedId, setPickedId] = useState(null);
  const [openId, setOpenId] = useState(null);       // assembly whose Full View modal is open
  const [dataVersion, setDataVersion] = useState(0); // bumped on any edit so child panels reload
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      // Both come straight from Master Data on the backend. On failure we surface
      // an error rather than showing stale/fake/cached assembly data.
      const [ov, asm] = await Promise.all([
        api("/api/leader-assessment/overview"),
        api("/api/leader-assessment/assemblies"),
      ]);
      setData(ov);
      setAssemblies(asm.assemblies || []);
    } catch (e) {
      // On a silent refresh keep the last good data rather than blanking the page.
      if (!silent) { setError(e.message || "Failed to load the overview."); setData(null); setAssemblies([]); }
    } finally { if (!silent) setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // After any assessment edit: re-pull the overview stats/rankings AND bump the
  // version so the open panel/full-view reload their own bundles — everything
  // updates with no manual refresh.
  const refresh = useCallback(() => { load({ silent: true }); setDataVersion((v) => v + 1); }, [load]);

  // THE single entry point to the one Full Assessment modal (AssemblyFullView).
  // BOTH the Assembly Search panel's "Full View" button AND every Assemblies List
  // "Open" button call this exact function with the assembly's real DB id — so
  // there is only ever one Full View component, one data flow, one popup. Guards
  // a missing/invalid id so a bad row can never open an "undefined" assembly.
  const openAssemblyFullView = useCallback((assemblyId) => {
    const id = Number(assemblyId);
    if (!Number.isInteger(id) || id <= 0) return;
    setOpenId(id);
  }, []);

  const s = data?.stats;
  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock msg={error} onRetry={() => load()} />;
  return (
    <div className="space-y-5">
      {/* Assembly search — options come only from the master-backed list; the
          selected id (a real DB id) drives the assessment load below. */}
      <Card title="Find an Assembly" icon={Search} sub="Search any assembly by name to load its assessment. Assemblies come from Master Data.">
        <AssemblyCombobox assemblies={assemblies} value={pickedId} onPick={setPickedId} />
      </Card>
      {/* Search result / selected assembly — appears directly BELOW the Search
          Card; the Search Card above never moves. */}
      {pickedId && <AssemblyAssessmentPanel assemblyId={pickedId} onOpen={openAssemblyFullView} version={dataVersion} />}

      {/* Top 10 rankings — side-by-side on desktop (LEFT: assemblies, RIGHT:
          candidates), stacked on tablet/mobile. Both ranked by the real
          assessment scores computed on the backend and capped at 10; fewer than
          10 valid records simply show fewer rows. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* LEFT: Top 10 Ranked Assemblies (by Assembly Score, highest → lowest) */}
        <Card title="Top 10 Ranked Assemblies" icon={Trophy} sub="By Assembly Score = the assembly's top AAP candidate assessment total (highest → lowest).">
          {!(data?.top_assemblies?.length > 0) ? (
            <div className="text-sm text-gray-400">No assemblies have an assessment score yet.</div>
          ) : (
            <div className="space-y-2.5">
              {data.top_assemblies.slice(0, 10).map((r) => (
                <div key={r.assembly_id} onClick={() => setPickedId(r.assembly_id)} className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 rounded-lg -mx-1 px-1 py-1" title="Open this assembly">
                  <span className={`w-6 text-center font-bold shrink-0 ${r.rank <= 3 ? RANK_COLOR[r.rank - 1] : "text-gray-400"}`}>{r.rank}</span>
                  <div className="w-36 min-w-0"><div className="font-semibold text-gray-900 truncate text-sm">{r.assembly_name}</div><div className="text-xs text-gray-400 truncate">{[r.district, r.mla_name].filter(Boolean).join(" · ") || "—"}</div></div>
                  <div className="flex-1 min-w-0"><ScoreBar value={r.assembly_score} max={100} showValue={false} /></div>
                  <span className="font-bold text-[#164FA3] w-16 text-right shrink-0">{r.assembly_score}/100</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* RIGHT: Top 10 Ranked Candidates (by total assessment score) */}
        <Card title="Top 10 Ranked Candidates" icon={Trophy} sub="By total 10-parameter assessment score, 0–100 (highest → lowest).">
          {!(data?.top_candidates?.length > 0) ? (
            <div className="text-sm text-gray-400">No candidates have an assessment score yet.</div>
          ) : (
            <div className="space-y-2.5">
              {data.top_candidates.slice(0, 10).map((c, i) => (
                <div key={c.id} className="flex items-center gap-3">
                  <span className={`w-6 text-center font-bold shrink-0 ${i < 3 ? RANK_COLOR[i] : "text-gray-400"}`}>{i + 1}</span>
                  <div className="w-36 min-w-0"><div className="font-semibold text-gray-900 truncate text-sm">{c.name}</div><div className="text-xs text-gray-400 truncate">{c.assembly_name}</div></div>
                  <div className="flex-1 min-w-0"><ScoreBar value={c.total} max={100} showValue={false} /></div>
                  <span className="font-bold text-[#164FA3] w-16 text-right shrink-0">{c.total}/100</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Overview status cards — part of "Other Overview sections", below the
          Search Card, selected assembly and Top Ranked sections. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* MLA Data is the first metric: the actual number of unique assemblies
            that currently have a valid, linked MLA profile — same DISTINCT
            master-linked count as the MLA Data List (never Master-Data blindly,
            never empty/duplicate profiles). Updates on MLA create/edit/delete. */}
        <Stat label="MLA Data" value={s?.assemblies_with_mla} />
        {/* Total Candidate is the second metric: the candidate-wise total of all
            valid candidate records across every assembly (COUNT of la_aap_candidates,
            each counted once) — NOT assembly-wise, not assumed 3/assembly, not
            hardcoded. Updates on candidate create/delete/update. */}
        <Stat label="Total Candidate" value={s?.total_candidates} />
        {/* Candidate Assessment Done is the third metric: individual candidates
            whose FULL 10-parameter assessment is complete (all 10 scores > 0) —
            not merely an assessment record existing, not partial, not total-score
            only. Recomputed live from the scores on every load. */}
        <Stat label="Candidate Assessment Done" value={s?.assessments_completed} />
        {/* Assembly Candidate is the fourth metric — ASSEMBLY-WISE (never per
            candidate): the number of unique assemblies counted once when EVERY
            candidate in the assembly has a complete 10-parameter assessment (the
            shared assemblyComplete rule = total_completed_assemblies). An assembly
            with any pending candidate counts 0; 3 completed candidates count as 1.
            Auto-updates when candidate assessments change. */}
        <Stat label="Assembly Candidate" value={s?.total_completed_assemblies} />
        <Stat label="With Candidates Data" value={s?.assemblies_with_candidates} />
        <Stat label="Avg Candidate Score" value={s?.average_score != null ? `${s.average_score}/100` : null} />
      </div>

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
                    <td className="px-3 py-2.5">{a.completed
                      ? <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">Completed</span>
                      : <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Pending</span>}</td>
                    <td className="px-3 py-2.5 text-right"><button onClick={() => openAssemblyFullView(a.id)} className="text-[#164FA3] font-semibold hover:underline text-xs">Open →</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ONE Full View modal for the whole Overview — used identically by the
          Assemblies List "Open" and the Assembly Search panel's "Full View"
          (both just set openId to the real la_assemblies id). key={openId}
          forces a fresh mount per assembly, so switching from Assembly A to B
          never shows A's stale data. Editing inside triggers a silent refresh of
          the stats/rankings + open panel, so every surface updates. */}
      {openId && <AssemblyFullView key={openId} assemblyId={openId} onClose={() => setOpenId(null)} onChange={refresh} flash={flash} fail={fail} />}
    </div>
  );
}

// Searchable assembly picker. Options come ONLY from the master-backed list
// passed in (each carries its real DB id); selecting one calls onPick(id). Filter
// is client-side over the already-loaded list, so it stays instant even with the
// full 90 assemblies, and ids are de-duped defensively.
function AssemblyCombobox({ assemblies, value, onPick }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const selected = assemblies.find((a) => String(a.id) === String(value));
  const seen = new Set();
  const list = assemblies.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? list.filter((a) => `${a.name} ${a.district || ""}`.toLowerCase().includes(needle))
    : list;
  return (
    <div className="relative">
      <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2.5 bg-white focus-within:ring-2 focus-within:ring-[#164FA3]/40">
        <Search size={16} className="text-gray-400 shrink-0" />
        <input
          value={open ? q : (selected ? `${selected.name}${selected.district ? ` · ${selected.district}` : ""}` : q)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => { setOpen(true); setQ(""); }}
          placeholder="Search any assembly by name…"
          className="flex-1 outline-none text-sm bg-transparent text-gray-900"
        />
        {selected && !open && (
          <button onClick={() => { onPick(null); setQ(""); }} className="text-gray-400 hover:text-gray-600" title="Clear"><X size={15} /></button>
        )}
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-72 overflow-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-sm text-gray-400">No assemblies match “{q}”.</div>
            ) : filtered.map((a) => (
              <button
                key={a.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onPick(a.id); setOpen(false); setQ(""); }}
                className={`w-full text-left px-3 py-2 hover:bg-gray-50 text-sm ${String(a.id) === String(value) ? "bg-[#164FA3]/5" : ""}`}
              >
                <span className="font-semibold text-gray-900">{a.name}</span>
                {a.district && <span className="text-gray-400"> · {a.district}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Assembly Overview panel for the assembly picked in the search box. Fetches the
// full bundle by the assembly's DB id (loading / error / empty states) and lays
// it out as: LEFT = Top 3 AAP candidates by Total Assessment Score (highest
// first); RIGHT = the sitting MLA. A prominent "Full View" button opens the
// complete assessment.
function AssemblyAssessmentPanel({ assemblyId, onOpen, version }) {
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // `version` is bumped by the parent after any edit, so the panel re-fetches and
  // its Top 3 candidates + MLA score reflect the latest assessment automatically.
  const load = useCallback(async () => {
    // Clear stale data so a previously-selected assembly's overview never lingers
    // while the newly-picked assembly loads.
    setLoading(true); setError(""); setBundle(null);
    try { setBundle(await api(`/api/leader-assessment/assemblies/${assemblyId}`)); }
    catch (e) { setError(e.message || "Failed to load the assessment."); setBundle(null); }
    finally { setLoading(false); }
  }, [assemblyId, version]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Card title="Assembly Overview" icon={ClipboardCheck}><LoadingBlock /></Card>;
  if (error) return <Card title="Assembly Overview" icon={ClipboardCheck}><ErrorBlock msg={error} onRetry={load} /></Card>;
  if (!bundle?.assembly) return null;
  const { assembly, mla, candidates = [], status } = bundle;
  // Sorted by Total Assessment Score, highest first; take the top 3.
  const top3 = [...candidates].sort((a, b) => b.total - a.total).slice(0, 3);
  const hasAnything = candidates.length > 0 || (mla && mla.name);

  return (
    <>
      <Card
        title={`Assembly Overview · ${assembly.name}`}
        icon={ClipboardCheck}
        sub={[assembly.district, assembly.number ? `Seat #${assembly.number}` : null].filter(Boolean).join(" · ")}
        right={
          <button onClick={() => onOpen(assembly.id)} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-3.5 py-2 rounded-lg text-sm font-semibold">
            <BarChart3 size={16} /> Full View
          </button>
        }
      >
        {!hasAnything ? (
          <Empty
            msg="No assessment recorded for this assembly yet."
            action={<button onClick={() => onOpen(assembly.id)} className="inline-flex items-center gap-1.5 bg-[#164FA3] text-white px-3 py-2 rounded-lg text-sm font-semibold">Start assessing →</button>}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* LEFT: Top 3 AAP candidates by score */}
            <div className="lg:col-span-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Top 3 AAP Candidates</div>
              {top3.length === 0 ? (
                <div className="text-sm text-gray-400">No AAP candidates added yet.</div>
              ) : (
                <div className="space-y-2.5">
                  {top3.map((c, i) => (
                    <div key={c.id} className="flex items-center gap-3 border border-gray-100 rounded-xl p-2.5">
                      <span className={`w-6 text-center font-bold ${i < 3 ? RANK_COLOR[i] : "text-gray-400"}`}>{i + 1}</span>
                      <ProfilePhoto name={c.name} src={c.photo_url} size={48} editable={false} className="bg-[#164FA3]/10 border border-gray-200 shrink-0" textClassName="text-[#164FA3]" />
                      <div className="w-32 min-w-0"><div className="font-semibold text-gray-900 truncate text-sm">{c.name}</div></div>
                      <div className="flex-1"><ScoreBar value={c.total} max={100} showValue={false} /></div>
                      <span className="font-bold text-[#164FA3] w-16 text-right">{c.total}/100</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* RIGHT: Current Sitting MLA of THIS assembly (mla is fetched by the
                selected assembly id, so it always belongs to this assembly). */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Current Sitting MLA</div>
              {mla && mla.name ? (
                <div className="border border-gray-100 rounded-xl p-4">
                  <div className="flex flex-col items-center text-center">
                    <ProfilePhoto name={mla.name} src={mla.photo_url} size={96} square editable={false} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3]" />
                    <div className="font-bold text-gray-900 mt-2 truncate max-w-full">{mla.name}</div>
                    <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">Current MLA · {assembly.name}{assembly.district ? ` · ${assembly.district}` : ""}</div>
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 mt-3 text-left">
                    <MlaField label="Age" value={mla.age != null ? String(mla.age) : "—"} />
                    <MlaField label="Party" value={mla.party || "—"} />
                    <MlaField label="Caste" value={mla.caste || "—"} />
                    <MlaField label="Criminal Cases" value={mla.criminal_cases != null ? String(mla.criminal_cases) : "—"} />
                    <MlaField label="Net Worth" value={mla.net_worth || "—"} />
                    <MlaField label="Times Won" value={mla.times_won != null ? String(mla.times_won) : "—"} />
                    <MlaField label="Winning Margin" value={mla.competitor_margin != null ? nfmt(mla.competitor_margin) : "—"} />
                    <MlaField label="MLA Score" value={mla.assessment_done ? `${mla.total}/100` : "Not assessed"} accent={mla.assessment_done} />
                  </div>
                </div>
              ) : (
                <div className="border border-dashed border-gray-200 rounded-xl p-6 text-center">
                  <UserSquare2 size={28} className="mx-auto text-gray-300 mb-2" />
                  <div className="text-sm font-medium text-gray-500">MLA Data Not Available</div>
                  <div className="text-[11px] text-gray-400 mt-1">No MLA profile is linked to this assembly yet.</div>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

// One label/value row inside the Sitting MLA card.
function MlaField({ label, value, accent }) {
  return (
    <div className="flex justify-between text-sm gap-2">
      <span className="text-gray-400 shrink-0">{label}</span>
      <span className={`font-medium truncate text-right ${accent ? "text-[#164FA3] font-semibold" : "text-gray-700"}`} title={value}>{value}</span>
    </div>
  );
}

// Full View — the COMPLETE assessment of one assembly in a single modal: the
// gradient header, the 10-parameter per-candidate assessment + ranking +
// MLA-vs-AAP + recommendation (ComparisonTab), and the editable Top 3 Reasons /
// Top 5 Strengths / Top 10 Weaknesses + Assembly Social Profile (AnalysisTab).
// Everything is fetched live by the assembly id and re-fetched after any edit.
function AssemblyFullView({ assemblyId, onClose, onChange, flash, fail }) {
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    // Clear the previous assembly's bundle up front so its data can never be
    // shown while the newly-selected assembly loads (no stale A → B carryover).
    setLoading(true); setError(""); setBundle(null);
    try { setBundle(await api(`/api/leader-assessment/assemblies/${assemblyId}`)); }
    catch (e) { setError(e.message || "Failed to load the assessment."); setBundle(null); }
    finally { setLoading(false); }
  }, [assemblyId]);
  useEffect(() => { load(); }, [load]);
  // Any edit inside reloads this modal AND notifies the parent (Overview) so its
  // stats, rankings and open panel refresh too — no manual page refresh.
  const reload = () => { load(); onChange?.(); };
  return (
    <Modal title="Full Assessment" onClose={onClose} size="full">
      {loading ? <LoadingBlock /> : error ? <ErrorBlock msg={error} onRetry={load} /> : bundle?.assembly ? (
        <div className="space-y-5">
          <AssemblyHeader a={bundle.assembly} status={bundle.status} />
          {bundle.candidates?.length > 0
            ? <ComparisonTab b={bundle} onChange={reload} flash={flash} fail={fail} />
            : <Empty msg="No AAP candidates yet — add candidates and score them to see the 10-parameter assessment." />}
          <AnalysisTab b={bundle} onChange={reload} flash={flash} fail={fail} />
        </div>
      ) : (
        // Graceful empty state instead of a blank modal when the assembly has no
        // loadable record (e.g. removed from Master Data after the list loaded).
        <Empty msg="This assembly's assessment could not be loaded. It may no longer exist in Master Data." action={<button onClick={load} className="text-sm font-semibold text-[#164FA3] hover:underline">Retry</button>} />
      )}
    </Modal>
  );
}

// -------------------------------- MLA -------------------------------------
const EMPTY_MLA = { photo_url: "", name: "", phone: "", address: "", date_of_birth: "", caste: "", party: "", net_worth: "", criminal_cases: "", times_won: "", times_contested: "", largest_winning_margin: "", previous_winning_margin: "", party_won_from: "", party_defeated: "", competitor1_party: "", competitor1_votes: "", competitor2_party: "", competitor2_votes: "" };

// Victory margin between the two leading competitors — computed live for the form
// preview (the backend recomputes and stores the authoritative value). Returns
// null unless BOTH vote counts are valid whole numbers ≥ 0; ABS() keeps it from
// ever being negative.
function competitorMargin(v1, v2) {
  const a = String(v1 ?? "").trim(), b = String(v2 ?? "").trim();
  if (a === "" || b === "") return null;
  const n1 = Number(a), n2 = Number(b);
  if (!Number.isFinite(n1) || !Number.isFinite(n2)) return null;
  return Math.abs(n1 - n2);
}
// (The old per-assembly MlaTab was replaced by the global MlaManager below.)

// --------------------------- MLA MANAGER ----------------------------------
// The MLA Profile tab: a global manager with a "+ Create MLA Profile" action and
// the complete, DB-driven MLA Data List (one row per MLA). Each row shows MLA
// name, assembly, district, party, assessment score and status, with Open (view/
// edit the full profile) and Add Assessment (score the 10 parameters). MLAs are
// one-per-assembly (unique), so no duplicates are created; the list refreshes
// immediately after any save with no browser refresh.
function MlaManager({ flash, fail }) {
  const [assemblies, setAssemblies] = useState([]);
  const [mlas, setMlas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);          // null | "new" | mla  (profile create/edit)
  const [expandedId, setExpandedId] = useState(null);    // inline-expanded MLA row
  const [editingAssessment, setEditingAssessment] = useState(null); // mla (full assessment edit)
  const [version, setVersion] = useState(0);             // bumped after an edit to refresh the inline view
  const [q, setQ] = useState("");                        // MLA-list search

  const loadAssemblies = useCallback(async () => {
    try { const d = await api("/api/leader-assessment/assemblies"); setAssemblies(d.assemblies || []); } catch { /* surfaced by MLA load */ }
  }, []);
  const loadMlas = useCallback(async () => {
    setLoading(true); setError("");
    try { const d = await api("/api/leader-assessment/mlas"); setMlas(d.mlas || []); }
    catch (e) { setError(e.message); setMlas([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { loadAssemblies(); loadMlas(); }, [loadAssemblies, loadMlas]);
  // After any assessment/analysis edit, refresh both the list and the inline view.
  const afterEdit = () => { loadMlas(); setVersion((v) => v + 1); };

  // Assemblies that already have an MLA — excluded from the Create dropdown so a
  // second profile can't be created for the same assembly (edit the existing one).
  const takenAsm = new Set(mlas.map((m) => Number(m.assembly_id)));
  // Keep an open assessment modal bound to the freshest record after a refresh.
  const editingAssessmentLive = editingAssessment ? (mlas.find((m) => m.id === editingAssessment.id) || editingAssessment) : null;
  // Client-side filter over the already-loaded list (bounded to one MLA per
  // assembly), matching name / assembly / district / party — instant, no refetch.
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? mlas.filter((m) => `${m.name || ""} ${m.assembly_name || ""} ${m.district || ""} ${m.party || ""}`.toLowerCase().includes(needle))
    : mlas;

  return (
    <div className="space-y-5">
      <Card
        title="MLA Profiles"
        icon={UserSquare2}
        sub="Every sitting MLA. Create a profile, then score them with Add Assessment."
        right={<button onClick={() => setEditing("new")} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-3.5 py-2 rounded-lg text-sm font-semibold"><Plus size={16} /> Create MLA Profile</button>}
      >
        {loading ? <LoadingBlock /> : error ? <ErrorBlock msg={error} onRetry={loadMlas} /> : mlas.length === 0 ? (
          <Empty msg="No MLA profiles yet." action={<button onClick={() => setEditing("new")} className="inline-flex items-center gap-1.5 bg-[#164FA3] text-white px-3 py-2 rounded-lg text-sm font-semibold"><Plus size={15} /> Create MLA Profile</button>} />
        ) : (
          <>
            <div className="flex items-center gap-2 mb-4 max-w-md">
              <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2 bg-white w-full focus-within:ring-2 focus-within:ring-[#164FA3]/40">
                <Search size={15} className="text-gray-400 shrink-0" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search MLA, assembly, district or party…" className="flex-1 outline-none text-sm bg-transparent" />
                {q && <button onClick={() => setQ("")} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>}
              </div>
            </div>
            {shown.length === 0 ? <div className="text-sm text-gray-400 py-6 text-center">No MLAs match “{q}”.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500"><tr>{["MLA", "Assembly", "District", "Party", "Assessment Score", "Status", ""].map((h) => <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100">
                {shown.map((m) => {
                  const open = expandedId === m.id;
                  return (
                    <Fragment key={m.id}>
                      <tr className={open ? "bg-[#164FA3]/5" : "hover:bg-gray-50"}>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <ProfilePhoto name={m.name} src={m.photo_url} size={34} editable={false} className="bg-[#164FA3]/10 border border-gray-200 shrink-0" textClassName="text-[#164FA3]" />
                            <div className="min-w-0"><div className="font-semibold text-gray-900 truncate">{m.name}</div>{m.phone && <div className="text-[11px] text-gray-400 truncate">{m.phone}</div>}</div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{m.assembly_name || "—"}</td>
                        <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{m.district || "—"}</td>
                        <td className="px-3 py-2.5 text-gray-700">{m.party || "—"}</td>
                        <td className="px-3 py-2.5"><div className="flex items-center gap-2 min-w-[130px]"><ScoreBar value={m.total} max={100} showValue={false} /><span className="text-sm font-bold text-[#164FA3] w-14 text-right">{m.total}/100</span></div></td>
                        <td className="px-3 py-2.5"><span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${m.assessment_done ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{m.assessment_done ? "Assessed" : "Pending"}</span></td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <button onClick={() => setExpandedId(open ? null : m.id)} className="text-xs font-bold text-[#164FA3] hover:bg-[#164FA3]/10 px-2.5 py-1 rounded-lg inline-flex items-center gap-1">{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {open ? "Close" : "Open"}</button>
                          <button onClick={() => setEditingAssessment(m)} className="text-xs font-bold text-[#164FA3] hover:bg-[#164FA3]/10 px-2.5 py-1 rounded-lg inline-flex items-center gap-1"><ClipboardCheck size={13} /> Add Assessment</button>
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={7} className="px-3 pb-4 pt-0 bg-[#164FA3]/5">
                            <MlaInlineAssessment
                              mla={m}
                              version={version}
                              onEditAssessment={() => setEditingAssessment(m)}
                              onEditProfile={() => setEditing(m)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
            )}
          </>
        )}
      </Card>

      {editing && (
        <MlaProfileModal
          assemblies={assemblies}
          taken={takenAsm}
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); flash("MLA profile saved."); loadMlas(); }}
          fail={fail}
        />
      )}
      {editingAssessmentLive && <MlaAssessmentEditModal mla={editingAssessmentLive} onClose={() => setEditingAssessment(null)} onChange={afterEdit} flash={flash} fail={fail} />}
    </div>
  );
}
// Inline (expanded-row) read view of an MLA's complete assessment: the
// 10-parameter scores + total, the assembly's Top 3 Reasons / Top 5 Strengths /
// Top 10 Weaknesses, and the Assembly Social Profile (Top 3 caste/community with
// percentages). "Edit Assessment" opens the editable form; "Edit Profile" opens
// the MLA profile form. `version` forces a re-fetch after an edit.
function MlaInlineAssessment({ mla, version, onEditAssessment, onEditProfile }) {
  const [ctx, setCtx] = useState(null);   // { analysis, social } for the assembly
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const b = await api(`/api/leader-assessment/assemblies/${mla.assembly_id}`);
      setCtx({ analysis: b.analysis || {}, social: b.social || [] });
    } catch (e) { setError(e.message || "Failed to load."); setCtx(null); }
    finally { setLoading(false); }
  }, [mla.assembly_id, version]);
  useEffect(() => { load(); }, [load]);

  const reasons = (ctx?.analysis?.reasons_won || []).filter((x) => String(x || "").trim()).slice(0, 3);
  const strengths = (ctx?.analysis?.strengths || []).filter((x) => String(x || "").trim()).slice(0, 5);
  const weaknesses = (ctx?.analysis?.weaknesses || []).filter((x) => String(x || "").trim()).slice(0, 10);
  const social = (ctx?.social || []).slice(0, 3);

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="font-bold text-gray-900 flex items-center gap-2"><ClipboardCheck size={16} className="text-[#164FA3]" /> MLA Assessment · {mla.name}</h4>
        <div className="flex items-center gap-2">
          <button onClick={onEditProfile} className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-[#164FA3] px-2 py-1.5 rounded-lg"><UserSquare2 size={14} /> Edit Profile</button>
          <button onClick={onEditAssessment} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-3 py-1.5 rounded-lg text-sm font-semibold"><Pencil size={14} /> Edit Assessment</button>
        </div>
      </div>

      {/* 10-parameter assessment */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">10-Parameter Assessment</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {PARAMS.map((p, i) => {
            const v = mla.assessment?.[p.key];
            return (
              <div key={p.key} className="flex items-center gap-2 text-sm">
                <span className="text-gray-400 w-5 shrink-0">{i + 1}.</span>
                <span className="text-gray-700 flex-1 truncate">{p.label}</span>
                <span className="font-semibold text-gray-900 shrink-0">{v != null ? v : "—"}<span className="text-gray-400 font-normal">/10</span></span>
              </div>
            );
          })}
        </div>
        <div className="mt-2 pt-2 border-t border-gray-200 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-700">Total Score</span>
          <span className="text-lg font-bold text-[#164FA3]">{mla.total} / 100</span>
        </div>
      </div>

      {/* Competitor election result + derived margin. Absent on legacy profiles → "—". */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Competitor Election Result</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-gray-100 p-3">
            <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Competitor 1</div>
            <div className="font-semibold text-gray-900 truncate">{mla.competitor1_party || "—"}</div>
            <div className="text-sm text-gray-600">{mla.competitor1_votes != null ? `${nfmt(mla.competitor1_votes)} votes` : "—"}</div>
          </div>
          <div className="rounded-xl border border-gray-100 p-3">
            <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Competitor 2</div>
            <div className="font-semibold text-gray-900 truncate">{mla.competitor2_party || "—"}</div>
            <div className="text-sm text-gray-600">{mla.competitor2_votes != null ? `${nfmt(mla.competitor2_votes)} votes` : "—"}</div>
          </div>
          <div className="rounded-xl border border-[#164FA3]/20 bg-[#164FA3]/5 p-3">
            <div className="text-[11px] font-bold text-[#164FA3] uppercase tracking-wide">Margin</div>
            <div className="text-lg font-bold text-[#164FA3]">{mla.competitor_margin != null ? nfmt(mla.competitor_margin) : "—"}</div>
            <div className="text-[11px] text-gray-400">|Votes 1 − Votes 2|</div>
          </div>
        </div>
      </div>

      {loading ? <LoadingBlock /> : error ? <ErrorBlock msg={error} onRetry={load} /> : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Order: Weakness → Strength → Winning. */}
            <ReadList title="Top 10 Weaknesses" items={weaknesses} accent="text-red-600" empty="No weaknesses recorded." />
            <ReadList title="Top 5 Strengths" items={strengths} accent="text-[#164FA3]" empty="No strengths recorded." />
            <ReadList title="Top 3 Reasons for Winning" items={reasons} accent="text-emerald-700" empty="No reasons recorded." />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Assembly Social Profile · Top 3 Caste / Community</div>
            {social.length === 0 ? <div className="text-sm text-gray-400">No social profile recorded.</div> : (
              <div className="space-y-1.5">
                {social.map((row, i) => {
                  const pct = Number(row.percentage) || 0;
                  return (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <span className="text-xs font-bold text-gray-400 w-14 shrink-0">Caste {i + 1}</span>
                      <span className="text-gray-800 font-medium w-40 truncate">{row.name || "—"}</span>
                      <div className="flex-1 hidden sm:block"><div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-[#164FA3] rounded-full" style={{ width: `${Math.min(100, pct)}%` }} /></div></div>
                      <span className="font-semibold text-gray-900 w-12 text-right shrink-0">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
function ReadList({ title, items, accent, empty }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{title}</div>
      {items.length === 0 ? <div className="text-sm text-gray-400">{empty}</div> : (
        <ol className="space-y-1">
          {items.map((it, i) => <li key={i} className="text-sm text-gray-700 flex gap-2"><span className={`font-bold shrink-0 ${accent}`}>{i + 1}.</span><span className="min-w-0">{it}</span></li>)}
        </ol>
      )}
    </div>
  );
}
// The COMPLETE MLA assessment form (opened by both "Add Assessment" and the
// inline "Edit Assessment"): the MLA 10-parameter editor (auto-total, never
// manually set) + the assembly's Top 3 Reasons / Top 5 Strengths / Top 10
// Weaknesses and Social Profile — keeping the MLA↔Assembly relationship intact.
function MlaAssessmentEditModal({ mla, onClose, onChange, flash, fail }) {
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setBundle(await api(`/api/leader-assessment/assemblies/${mla.assembly_id}`)); }
    catch (e) { setError(e.message || "Failed to load."); setBundle(null); }
    finally { setLoading(false); }
  }, [mla.assembly_id]);
  useEffect(() => { load(); }, [load]);
  const reload = () => { load(); onChange(); };
  return (
    <Modal title={`Assessment · ${mla.name}`} onClose={onClose} size="full">
      {loading ? <LoadingBlock /> : error ? <ErrorBlock msg={error} onRetry={load} /> : bundle ? (
        <div className="space-y-5">
          {/* Current MLA header — ABOVE the 10 parameters so the person being
              assessed is clear before any question is answered. Scoped to the
              selected assembly's MLA (bundle.mla); shows a clear not-available
              state if the assembly has no MLA. */}
          {(bundle.mla && bundle.mla.name) ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-4">
              <PassportPhoto name={bundle.mla.name} src={bundle.mla.photo_url} w={72} />
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Current MLA</div>
                <h3 className="text-lg font-bold text-gray-900 truncate flex items-center gap-2">
                  {bundle.mla.name}
                  {bundle.mla.party && <span className="text-xs font-semibold text-[#164FA3] bg-[#164FA3]/10 px-2 py-0.5 rounded-full">{bundle.mla.party}</span>}
                </h3>
                <div className="text-sm text-gray-500 flex items-center gap-1.5 mt-0.5"><MapPin size={13} className="text-[#164FA3]" /> {bundle.assembly?.name || mla.assembly_name || "—"}{bundle.assembly?.district ? ` · ${bundle.assembly.district}` : (mla.district ? ` · ${mla.district}` : "")}</div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-6 flex items-center gap-4 text-gray-500">
              <PassportPhoto name="" src={null} w={64} />
              <div>
                <div className="text-sm font-semibold text-gray-600">Current MLA not available</div>
                <div className="text-[11px] text-gray-400 mt-0.5">No MLA profile is linked to this assembly yet.</div>
              </div>
            </div>
          )}
          <Card title="10 Assessment Parameters" icon={ClipboardCheck} sub="Each parameter is scored 1–10; the total is calculated automatically out of 100.">
            <AssessmentEditor c={mla} endpoint={`/api/leader-assessment/mlas/${mla.id}/assessment`} onChange={reload} flash={flash} fail={fail} />
          </Card>
          <AnalysisTab b={bundle} onChange={reload} flash={flash} fail={fail} />
        </div>
      ) : null}
    </Modal>
  );
}
// Create / edit an MLA profile. The form carries every existing MLA field from
// the schema (no invented duplicates); the assembly comes from the Master-Data
// list and its DB id is the stored relationship. Saving upserts the single MLA
// row for that assembly (one per assembly → no duplicates).
function MlaProfileModal({ assemblies, taken, initial, onClose, onSaved, fail }) {
  const [form, setForm] = useState(() => ({
    ...EMPTY_MLA,
    ...(initial || {}),
    assembly_id: initial?.assembly_id != null ? String(initial.assembly_id) : "",
    date_of_birth: initial?.date_of_birth ? String(initial.date_of_birth).slice(0, 10) : "",
  }));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({}); // { assembly_id, name, _server }
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e)); };
  const age = ageOf(form.date_of_birth);
  // Live margin preview; the server recomputes and stores the authoritative value.
  const liveMargin = competitorMargin(form.competitor1_votes, form.competitor2_votes);
  // On create, hide assemblies that already have an MLA (prevents accidental
  // duplicate profiles); on edit, the assembly is fixed.
  const options = initial ? assemblies : assemblies.filter((a) => !(taken && taken.has(Number(a.id))));
  async function persistPhoto(blob) {
    if (!blob) return null;
    const fd = new FormData(); fd.append("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
    const up = await fetch("/api/uploads", { method: "POST", body: fd }); const d = await up.json().catch(() => ({}));
    if (!up.ok) throw new Error(d.message || "Upload failed"); return d.url;
  }
  async function save() {
    if (saving) return; // ignore extra clicks while the first request is in flight
    const errs = {};
    if (!String(form.assembly_id).trim()) errs.assembly_id = "Select the assembly this MLA represents.";
    if (!String(form.name).trim()) errs.name = "MLA name is required.";
    // Votes must be numeric only (whole number ≥ 0); invalid text is blocked so it
    // can never be stored as a vote count. Empty is allowed (no NaN produced).
    const validVotes = (v) => { const s = String(v ?? "").trim(); if (s === "") return true; const n = Number(s); return Number.isFinite(n) && Number.isInteger(n) && n >= 0; };
    if (!validVotes(form.competitor1_votes)) errs.competitor1_votes = "Enter a whole number of votes (0 or more).";
    if (!validVotes(form.competitor2_votes)) errs.competitor2_votes = "Enter a whole number of votes (0 or more).";
    setErrors(errs);
    if (Object.keys(errs).length) return; // keep the form open, values intact
    setSaving(true);
    try {
      await api(`/api/leader-assessment/assemblies/${form.assembly_id}/mla`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      onSaved(); // parent closes the modal + refreshes + toasts
    } catch (e) {
      setErrors({ _server: e.message || "Could not save the MLA profile. Please try again." });
      setSaving(false);
    }
  }
  return (
    <Modal title={initial ? "Edit MLA Profile" : "Create MLA Profile"} onClose={onClose} wide>
      <div className="flex flex-col items-center gap-1.5 pb-2">
        <ProfilePhoto name={form.name} src={form.photo_url} size={88} square editable persist={persistPhoto} onChange={(url) => set("photo_url", url || "")} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3]" />
        <span className="text-[11px] text-gray-400">JPG, PNG, WEBP</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <span className={lbl}>Assembly *</span>
          <select className={`${inp} ${errors.assembly_id ? "border-red-400 focus:ring-red-200" : ""}`} value={form.assembly_id ?? ""} disabled={!!initial} onChange={(e) => set("assembly_id", e.target.value)}>
            <option value="">— select assembly —</option>
            {options.map((a) => <option key={a.id} value={a.id}>{a.name}{a.district ? ` · ${a.district}` : ""}</option>)}
          </select>
          {errors.assembly_id && <span className="text-[11px] text-red-500 mt-0.5 block">{errors.assembly_id}</span>}
          {initial && <span className="text-[11px] text-gray-400">One MLA per assembly — the assembly can't be changed here.</span>}
        </div>
        <Field label="Full Name *" full value={form.name} onChange={(v) => set("name", v)} error={errors.name} />
        <Field label="Phone" value={form.phone} onChange={(v) => set("phone", v)} /><Field label="Party" value={form.party} onChange={(v) => set("party", v)} />
        <Field label="Date of Birth" type="date" value={form.date_of_birth} onChange={(v) => set("date_of_birth", v)} />
        <div><span className={lbl}>Age (auto)</span><div className={`${inp} bg-gray-50 text-gray-600`}>{age != null ? `${age} years` : "Age not available"}</div></div>
        <Field label="Caste" value={form.caste} onChange={(v) => set("caste", v)} /><Field label="Net Worth" value={form.net_worth} onChange={(v) => set("net_worth", v)} />
        <Field label="Criminal Cases" type="number" value={form.criminal_cases} onChange={(v) => set("criminal_cases", v)} />
        <Field label="Address" full value={form.address} onChange={(v) => set("address", v)} />
        <div className="col-span-2 border-t border-gray-100 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Political / Election details</div>
        <Field label="Times Won" type="number" value={form.times_won} onChange={(v) => set("times_won", v)} /><Field label="Times Contested" type="number" value={form.times_contested} onChange={(v) => set("times_contested", v)} />
        <Field label="Largest Winning Margin" type="number" value={form.largest_winning_margin} onChange={(v) => set("largest_winning_margin", v)} /><Field label="Previous Winning Margin" type="number" value={form.previous_winning_margin} onChange={(v) => set("previous_winning_margin", v)} />
        <Field label="Party Won From" value={form.party_won_from} onChange={(v) => set("party_won_from", v)} /><Field label="Party Defeated" value={form.party_defeated} onChange={(v) => set("party_defeated", v)} />

        <div className="col-span-2 border-t border-gray-100 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Competitor election result</div>
        <div className="col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 space-y-2">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Competitor 1</div>
            <Field label="Party Name 1" full value={form.competitor1_party} onChange={(v) => set("competitor1_party", v)} />
            <Field label="Total Votes 1" full type="number" value={form.competitor1_votes} onChange={(v) => set("competitor1_votes", v)} error={errors.competitor1_votes} />
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 space-y-2">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Competitor 2</div>
            <Field label="Party Name 2" full value={form.competitor2_party} onChange={(v) => set("competitor2_party", v)} />
            <Field label="Total Votes 2" full type="number" value={form.competitor2_votes} onChange={(v) => set("competitor2_votes", v)} error={errors.competitor2_votes} />
          </div>
        </div>
        <div className="col-span-2">
          <span className={lbl}>Margin (auto-calculated)</span>
          <div className={`${inp} bg-gray-50 text-gray-700 font-semibold`}>
            {liveMargin != null ? nfmt(liveMargin) : "—"}
            <span className="ml-2 text-[11px] font-normal text-gray-400">= |Total Votes 1 − Total Votes 2|</span>
          </div>
        </div>
      </div>
      {errors._server && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">{errors._server}</div>}
      <ModalActions onClose={onClose} onSave={save} saving={saving} />
    </Modal>
  );
}

// ----------------------------- ELECTIONS ----------------------------------
// Election History (the old MLA Profile Election History section) was removed —
// that functionality now lives in the Candidate / Election Data structure. The
// la_mla_elections table and its API routes are intentionally KEPT so existing
// election records are preserved and remain accessible; only the old UI is gone.

// ----------------------------- CANDIDATES ---------------------------------
// Standalone, Master-Data-driven Candidates workspace: a "+ Create Candidate"
// action on top and the COMPLETE candidate list (every assembly) below — no
// pre-selection needed. The assembly a candidate belongs to is chosen in the
// form from the same master-linked assembly list used across the module, and the
// list refreshes from the database immediately after every create/edit/remove.
const EMPTY_CAND = { assembly_id: "", photo_url: "", name: "", phone: "", address: "", date_of_birth: "", caste: "", net_worth: "", business: "", monthly_income: "", education: "", political_experience: "", organization_experience: "", previous_elections: "", current_position: "" };
function CandidatesTab({ flash, fail }) {
  const [assemblies, setAssemblies] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterAsm, setFilterAsm] = useState("");   // "" = all assemblies
  const [sortBy, setSortBy] = useState("assembly"); // "assembly" | "score"
  const [editing, setEditing] = useState(null);      // null | "new" | candidate
  const [opening, setOpening] = useState(null);      // candidate whose profile + assessment is open
  const [bundle, setBundle] = useState(null);        // per-assembly comparison (when a single assembly is selected)

  const loadAssemblies = useCallback(async () => {
    try { const d = await api("/api/leader-assessment/assemblies"); setAssemblies(d.assemblies || []); } catch { /* surfaced by the candidate load */ }
  }, []);
  const loadCandidates = useCallback(async (asmId) => {
    setLoading(true); setError("");
    try {
      const d = await api(`/api/leader-assessment/candidates${asmId ? `?assembly_id=${asmId}` : ""}`);
      setCandidates(d.candidates || []);
    } catch (e) { setError(e.message); setCandidates([]); }
    finally { setLoading(false); }
  }, []);
  const loadBundle = useCallback(async (asmId) => {
    if (!asmId) { setBundle(null); return; }
    try { setBundle(await api(`/api/leader-assessment/assemblies/${asmId}`)); } catch { setBundle(null); }
  }, []);

  useEffect(() => { loadAssemblies(); }, [loadAssemblies]);
  useEffect(() => { loadCandidates(filterAsm); loadBundle(filterAsm); }, [filterAsm, loadCandidates, loadBundle]);
  const refresh = useCallback(() => { loadCandidates(filterAsm); loadBundle(filterAsm); }, [filterAsm, loadCandidates, loadBundle]);

  // Keep the open profile/assessment modal bound to the freshest record after a
  // refresh (so the total/status reflect a just-saved assessment).
  const openingLive = opening ? (candidates.find((c) => c.id === opening.id) || opening) : null;
  // Ranked view when sorting by Total Score (desc), else the DB order (assembly).
  const view = sortBy === "score"
    ? [...candidates].sort((a, b) => (b.total - a.total) || String(a.name || "").localeCompare(String(b.name || "")))
    : candidates;

  async function del(c) {
    if (!confirm(`Remove candidate "${c.name}"?`)) return;
    try { await api(`/api/leader-assessment/candidates/${c.id}`, { method: "DELETE" }); flash("Candidate removed."); refresh(); }
    catch (e) { fail(e.message); }
  }

  return (
    <div className="space-y-5">
      <Card
        title="AAP Candidates"
        icon={Users}
        sub="Every AAP candidate across all assemblies. Click Open on a candidate to view their profile and score the 10-parameter assessment."
        right={
          <button onClick={() => setEditing("new")} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-3.5 py-2 rounded-lg text-sm font-semibold">
            <Plus size={16} /> Create Candidate
          </button>
        }
      >
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-sm font-semibold text-gray-600 flex items-center gap-1.5"><MapPin size={15} className="text-[#164FA3]" /> Assembly</span>
          <select value={filterAsm} onChange={(e) => setFilterAsm(e.target.value)} className={`${inp} max-w-xs`}>
            <option value="">All assemblies</option>
            {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}{a.district ? ` · ${a.district}` : ""}</option>)}
          </select>
          <span className="text-sm font-semibold text-gray-600 flex items-center gap-1.5 ml-1">Sort</span>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className={`${inp} max-w-[200px]`}>
            <option value="assembly">Assembly (A–Z)</option>
            <option value="score">Total Score (high → low)</option>
          </select>
        </div>

        {loading ? <LoadingBlock /> : error ? <ErrorBlock msg={error} onRetry={refresh} /> : candidates.length === 0 ? (
          <Empty msg={filterAsm ? "No candidates for this assembly yet." : "No candidates yet."} action={<button onClick={() => setEditing("new")} className="inline-flex items-center gap-1.5 bg-[#164FA3] text-white px-3 py-2 rounded-lg text-sm font-semibold"><Plus size={15} /> Create Candidate</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500"><tr>{[sortBy === "score" ? "#" : "", "Candidate", "Assembly", "District", "Type / Category", "Status", "Assessment Score", ""].map((h, i) => <th key={i} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100">
                {view.map((c, idx) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5 text-gray-400 font-bold w-8">{sortBy === "score" ? idx + 1 : ""}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <ProfilePhoto name={c.name} src={c.photo_url} size={34} editable={false} className="bg-[#164FA3]/10 border border-gray-200 shrink-0" textClassName="text-[#164FA3]" />
                        <div className="min-w-0">
                          <div className="font-semibold text-gray-900 truncate">{c.name}</div>
                          <AgeLine person={c} />
                          {c.phone && <div className="text-[11px] text-gray-400 truncate">{c.phone}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{c.assembly_name || "—"}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{c.district || "—"}</td>
                    <td className="px-3 py-2.5"><span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#164FA3]/10 text-[#164FA3] whitespace-nowrap">{c.current_position || "AAP Candidate"}</span></td>
                    <td className="px-3 py-2.5"><span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${c.assessment_done ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{c.assessment_done ? "Completed" : "Pending"}</span></td>
                    <td className="px-3 py-2.5"><div className="flex items-center gap-2 min-w-[130px]"><ScoreBar value={c.total} max={100} showValue={false} /><span className="text-sm font-bold text-[#164FA3] w-14 text-right">{c.total}/100</span></div></td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <button onClick={() => setOpening(c)} className="text-xs font-bold text-[#164FA3] hover:bg-[#164FA3]/10 px-2.5 py-1 rounded-lg inline-flex items-center gap-1"><ClipboardCheck size={14} /> Open</button>
                      <button onClick={() => setEditing(c)} className="text-gray-500 hover:text-[#164FA3] p-1" title="Edit"><Pencil size={14} /></button>
                      <button onClick={() => del(c)} className="text-gray-400 hover:text-red-600 p-1" title="Remove"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* When a single assembly is selected, keep the rich per-assembly comparison. */}
      {filterAsm && bundle?.candidates?.length > 0 && (
        <ComparisonTab b={bundle} onChange={refresh} flash={flash} fail={fail} />
      )}

      {editing && (
        <CandidateModal
          assemblies={assemblies}
          defaultAssemblyId={filterAsm || ""}
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); flash("Candidate saved."); refresh(); }}
          fail={fail}
        />
      )}
      {openingLive && (
        <CandidateOpenModal
          c={openingLive}
          onClose={() => setOpening(null)}
          onEdit={() => { setEditing(openingLive); setOpening(null); }}
          onChange={refresh}
          flash={flash}
          fail={fail}
        />
      )}
    </div>
  );
}
function CandidateModal({ assemblies, defaultAssemblyId, initial, onClose, onSaved, fail }) {
  const [form, setForm] = useState(() => ({
    ...EMPTY_CAND,
    ...(initial || {}),
    assembly_id: initial?.assembly_id != null ? String(initial.assembly_id) : (defaultAssemblyId ? String(defaultAssemblyId) : ""),
    date_of_birth: initial?.date_of_birth ? String(initial.date_of_birth).slice(0, 10) : "",
  }));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({}); // { assembly_id, name, _server }
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e)); };
  const age = ageOf(form.date_of_birth);
  async function persistPhoto(blob) {
    if (!blob) return null;
    const fd = new FormData(); fd.append("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
    const up = await fetch("/api/uploads", { method: "POST", body: fd }); const d = await up.json().catch(() => ({}));
    if (!up.ok) throw new Error(d.message || "Upload failed"); return d.url;
  }
  async function save() {
    if (saving) return; // ignore extra clicks while the first request is in flight
    // Validate → field-level errors; DON'T close, keep every entered value.
    const errs = {};
    if (!String(form.assembly_id).trim()) errs.assembly_id = "Select the assembly this candidate belongs to.";
    if (!form.name.trim()) errs.name = "Candidate name is required.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const url = initial ? `/api/leader-assessment/candidates/${initial.id}` : `/api/leader-assessment/assemblies/${form.assembly_id}/candidates`;
      await api(url, { method: initial ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      onSaved(); // parent closes the modal + refreshes the list + shows a toast
    } catch (e) {
      // Server error → keep the form open with all data; show a clear message.
      setErrors({ _server: e.message || "Could not save the candidate. Please try again." });
      setSaving(false);
    }
  }
  return (
    <Modal title={initial ? "Edit Candidate" : "Create AAP Candidate"} onClose={onClose}>
      <div className="flex flex-col items-center gap-1.5 pb-2">
        <ProfilePhoto name={form.name} src={form.photo_url} size={88} square editable persist={persistPhoto} onChange={(url) => set("photo_url", url || "")} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3]" />
        <span className="text-[11px] text-gray-400">JPG, PNG, WEBP</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <span className={lbl}>Assembly *</span>
          <select className={`${inp} ${errors.assembly_id ? "border-red-400 focus:ring-red-200" : ""}`} value={form.assembly_id ?? ""} onChange={(e) => set("assembly_id", e.target.value)}>
            <option value="">— select assembly —</option>
            {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}{a.district ? ` · ${a.district}` : ""}</option>)}
          </select>
          {errors.assembly_id && <span className="text-[11px] text-red-500 mt-0.5 block">{errors.assembly_id}</span>}
        </div>
        <Field label="Full Name *" full value={form.name} onChange={(v) => set("name", v)} error={errors.name} />
        <Field label="Phone" value={form.phone} onChange={(v) => set("phone", v)} /><Field label="Date of Birth" type="date" value={form.date_of_birth} onChange={(v) => set("date_of_birth", v)} />
        <div><span className={lbl}>Age (auto)</span><div className={`${inp} bg-gray-50 text-gray-600`}>{age != null ? `${age} years` : "Age not available"}</div></div>
        <Field label="Caste" value={form.caste} onChange={(v) => set("caste", v)} />
        <Field label="Net Worth" value={form.net_worth} onChange={(v) => set("net_worth", v)} /><Field label="Business" value={form.business} onChange={(v) => set("business", v)} />
        <Field label="Monthly Income" value={form.monthly_income} onChange={(v) => set("monthly_income", v)} /><Field label="Education" value={form.education} onChange={(v) => set("education", v)} />
        <Field label="Type / Current Position" value={form.current_position} onChange={(v) => set("current_position", v)} /><Field label="Political Experience" value={form.political_experience} onChange={(v) => set("political_experience", v)} />
        <Field label="Organization Experience" value={form.organization_experience} onChange={(v) => set("organization_experience", v)} /><Field label="Previous Elections" value={form.previous_elections} onChange={(v) => set("previous_elections", v)} />
        <Field label="Address" full value={form.address} onChange={(v) => set("address", v)} />
      </div>
      {errors._server && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">{errors._server}</div>}
      <ModalActions onClose={onClose} onSave={save} saving={saving} />
    </Modal>
  );
}

// ---------------------------- ASSESSMENT ----------------------------------
// The 10-parameter score editor for ONE candidate, embedded in that candidate's
// Open view (CandidateOpenModal). Scores load from the DB, the total is ALWAYS
// computed (never typed), each entry is clamped to 1..10, and a refresh re-seeds
// from c.assessment so nothing is lost. Saving upserts only this candidate's
// assessment row (no duplicate rows, other candidates untouched).
function AssessmentEditor({ c, endpoint, onChange, flash, fail }) {
  const url = endpoint || `/api/leader-assessment/candidates/${c.id}/assessment`;
  const [scores, setScores] = useState(() => Object.fromEntries(PARAMS.map((p) => [p.key, c.assessment?.[p.key] ?? ""])));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setScores(Object.fromEntries(PARAMS.map((p) => [p.key, c.assessment?.[p.key] ?? ""]))); }, [c.id, c.assessment]);
  const total = PARAMS.reduce((s, p) => s + (Number(scores[p.key]) || 0), 0);
  // Live completion progress — a parameter counts only with a valid score (>0),
  // the SAME rule the backend uses (assessmentComplete). All 10 → Completed.
  const filledParams = PARAMS.filter((p) => Number(scores[p.key]) > 0);
  const completedCount = filledParams.length;
  const isComplete = completedCount === PARAMS.length;
  const missing = PARAMS.filter((p) => !(Number(scores[p.key]) > 0));
  function setScore(k, v) {
    if (v === "") return setScores((s) => ({ ...s, [k]: "" }));
    let n = Math.floor(Number(v)); if (isNaN(n)) return; n = Math.max(SCORE_MIN, Math.min(SCORE_MAX, n));
    setScores((s) => ({ ...s, [k]: n }));
  }
  async function save() {
    if (saving) return; // prevent duplicate submissions
    setSaving(true);
    try { await api(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scores) }); flash(`Assessment saved for ${c.name}.`); onChange(); }
    catch (e) { fail(e.message); } finally { setSaving(false); }
  }
  return (
    <div>
      {/* Assessment progress — X/10 completed + status. Backend re-validates on
          save; this is the live in-form indicator. */}
      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Assessment Progress</span>
          <span className="text-sm font-bold text-gray-800 tabular-nums">{completedCount} / {PARAMS.length} completed</span>
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${isComplete ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{isComplete ? "Completed" : "Incomplete"}</span>
        </div>
        <div className="w-40 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${isComplete ? "bg-emerald-500" : "bg-[#164FA3]"}`} style={{ width: `${(completedCount / PARAMS.length) * 100}%` }} />
        </div>
      </div>
      <div className="space-y-2">
        {PARAMS.map((p, i) => (
          <div key={p.key} className="flex items-center gap-3">
            <span className="text-sm text-gray-700 w-56 shrink-0"><span className="text-gray-400 mr-1">{i + 1}.</span>{p.label}</span>
            <ScoreBar value={scores[p.key]} />
            <div className="flex items-center gap-1 shrink-0">
              <input type="number" min={SCORE_MIN} max={SCORE_MAX} step={1} value={scores[p.key]} onChange={(e) => setScore(p.key, e.target.value)} className="w-14 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center outline-none focus:ring-2 focus:ring-[#164FA3]/40" />
              <span className="text-xs text-gray-400 font-semibold w-6">/10</span>
            </div>
          </div>
        ))}
      </div>
      {!isComplete && missing.length > 0 && (
        <div className="mt-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span className="font-semibold">{missing.length} parameter{missing.length === 1 ? "" : "s"} still needed for completion:</span>{" "}
          {missing.map((p) => p.label).join(", ")}
        </div>
      )}
      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">TOTAL (auto)</span>
        <div className="flex items-center gap-3">
          <span className={`text-xl font-bold ${total >= 70 ? "text-emerald-600" : "text-[#164FA3]"}`}>{total} / 100</span>
          <SaveBtn onClick={save} saving={saving} />
        </div>
      </div>
    </div>
  );
}
// The candidate's "Open" view: complete profile + the 10-parameter assessment
// interface together on the same page (a modal, NOT a separate route). Profile
// fields are read-only here (Edit opens the full form); the assessment saves,
// reloads and re-totals through AssessmentEditor.
function CandidateOpenModal({ c, onClose, onEdit, onChange, flash, fail }) {
  const rows = [
    ["Assembly", c.assembly_name], ["District", c.district],
    ["Phone", c.phone],
    ["Caste", c.caste], ["Type / Position", c.current_position],
    ["Net Worth", c.net_worth], ["Business", c.business],
    ["Monthly Income", c.monthly_income], ["Education", c.education],
    ["Political Experience", c.political_experience], ["Organization Experience", c.organization_experience],
    ["Previous Elections", c.previous_elections], ["Address", c.address],
  ];
  return (
    <Modal title={`Candidate · ${c.name}`} onClose={onClose} wide>
      <div className="space-y-5">
        {/* Complete profile */}
        <div className="flex items-start gap-4">
          <ProfilePhoto name={c.name} src={c.photo_url} size={72} square editable={false} className="bg-[#164FA3]/10 border border-gray-200 shrink-0" textClassName="text-[#164FA3]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-bold text-gray-900 truncate">{c.name}</h3>
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${c.assessment_done ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{c.assessment_done ? "Completed" : "Pending"}</span>
              <span className="text-sm font-bold text-[#164FA3]">{c.total}/100</span>
            </div>
            <AgeLine person={c} />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 mt-3 text-xs">
              {rows.map(([k, v]) => (
                <div key={k} className="min-w-0"><span className="text-gray-400">{k}</span><div className="text-gray-800 font-medium truncate" title={v || ""}>{v || "—"}</div></div>
              ))}
            </div>
            <button onClick={onEdit} className="mt-3 text-xs font-semibold text-[#164FA3] hover:underline inline-flex items-center gap-1"><Pencil size={13} /> Edit profile</button>
          </div>
        </div>
        {/* 10-parameter assessment interface */}
        <div className="border-t border-gray-100 pt-4">
          <h4 className="font-bold text-gray-900 flex items-center gap-2 mb-1"><ClipboardCheck size={16} className="text-[#164FA3]" /> 10-Parameter Assessment</h4>
          <p className="text-xs text-gray-400 mb-3">Each parameter is scored 1–10. The total is calculated automatically out of 100.</p>
          <AssessmentEditor c={c} onChange={onChange} flash={flash} fail={fail} />
        </div>
      </div>
    </Modal>
  );
}

// ----------------------------- COMPARISON ---------------------------------
function ComparisonTab({ b, onChange, flash, fail }) {
  const ranked = b.candidates;
  if (ranked.length === 0) return <Empty msg="No AAP candidates to compare yet. Add candidates and score them first." />;

  // ONE unified comparison: the sitting MLA is the first column, followed by all
  // AAP candidates — the single source of truth for parameter-wise scores and
  // totals. MLA scores come ONLY from the actual MLA assessment (b.mla.assessment);
  // nothing is invented. A parameter with no stored MLA score shows "N/A", and an
  // MLA with no assessment at all shows "Not Assessed" for its total.
  // MLA is scoped to THIS assembly only (b.mla comes from this assembly's bundle),
  // so it can never show another assembly's MLA. Candidate/MLA photos + data come
  // straight from their saved profiles.
  const mla = b.mla;
  const mlaAssessed = !!(mla && PARAMS.some((p) => mla.assessment?.[p.key] != null));
  const columns = [];
  if (mla && mla.name) columns.push({ id: "mla", name: mla.name, role: "Sitting MLA", isMla: true, photo: mla.photo_url, assessment: mla.assessment || {}, total: mla.total, assessed: mlaAssessed });
  ranked.forEach((c, i) => columns.push({ id: `c${c.id}`, name: c.name, role: `Candidate ${i + 1}`, isMla: false, photo: c.photo_url, assessment: c.assessment || {}, total: c.total, assessed: true }));

  // Highest score per parameter (across MLA + all candidates); unscored (null)
  // counts as nothing. Totals only rank columns that carry a real assessment, so
  // a not-assessed MLA never wins the total highlight.
  const maxOf = (key) => Math.max(0, ...columns.map((col) => Number(col.assessment?.[key]) || 0));
  const maxTotal = Math.max(0, ...columns.filter((col) => col.assessed).map((col) => Number(col.total) || 0));
  return (
    <div className="space-y-4">
      {/* Main MLA section — the current MLA of this assembly with a clearly
          readable passport-style photo. This is the single MLA profile block;
          the MLA also appears as the first comparison column below. */}
      <Card title="Current MLA" icon={UserSquare2} sub={`Sitting MLA · ${b.assembly.name}${b.assembly.district ? ` · ${b.assembly.district}` : ""}`}>
        {mla && mla.name ? (
          <div className="flex items-start gap-4 flex-wrap">
            <PassportPhoto name={mla.name} src={mla.photo_url} w={104} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-bold text-gray-900 truncate">{mla.name}</h3>
                {mla.party && <span className="text-xs font-semibold text-[#164FA3] bg-[#164FA3]/10 px-2 py-0.5 rounded-full">{mla.party}</span>}
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${mla.assessment_done ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{mla.assessment_done ? `${mla.total}/100` : "Not Assessed"}</span>
              </div>
              <AgeLine person={mla} />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 mt-3 text-xs">
                {[["Party", mla.party], ["Caste", mla.caste], ["Criminal Cases", mla.criminal_cases != null ? String(mla.criminal_cases) : null], ["Net Worth", mla.net_worth], ["Times Won", mla.times_won != null ? String(mla.times_won) : null], ["Winning Margin", mla.competitor_margin != null ? nfmt(mla.competitor_margin) : null]].map(([k, v]) => (
                  <div key={k} className="min-w-0"><span className="text-gray-400">{k}</span><div className="text-gray-800 font-medium truncate" title={v || ""}>{v || "—"}</div></div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-gray-500">
            <PassportPhoto name="" src={null} w={72} />
            <div>
              <div className="text-sm font-medium text-gray-500">MLA Data Not Available</div>
              <div className="text-[11px] text-gray-400 mt-0.5">No MLA profile is linked to this assembly yet — add it on the MLA Profile tab.</div>
            </div>
          </div>
        )}
      </Card>

      <Card title="Candidate & MLA Comparison" icon={BarChart3} sub="Sitting MLA and all AAP candidates side by side. Highest score in each row is highlighted; scroll sideways if needed.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead><tr><th className="px-3 py-2 text-left font-semibold text-gray-500 min-w-[150px] align-bottom">Parameter</th>{columns.map((col) => (
              <th key={col.id} className={`px-3 py-2 text-center font-semibold text-gray-900 min-w-[110px] align-bottom ${col.isMla ? "bg-blue-50" : ""}`}>
                <div className="flex flex-col items-center gap-1.5">
                  <PassportPhoto name={col.name} src={col.photo} w={40} />
                  <div className="leading-tight">
                    <div className="truncate max-w-[120px]">{col.name}</div>
                    <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">{col.role}</div>
                  </div>
                </div>
              </th>
            ))}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {PARAMS.map((p) => { const mx = maxOf(p.key); return (
                <tr key={p.key}>
                  <td className="px-3 py-2 text-gray-600">{p.label} <span className="text-gray-400">/10</span></td>
                  {columns.map((col) => {
                    const v = col.assessment?.[p.key];
                    const hi = v != null && Number(v) === mx && mx > 0;
                    const display = v != null ? v : (col.isMla ? "N/A" : "—");
                    return <td key={col.id} className={`px-3 py-2 text-center ${hi ? "bg-emerald-50 font-bold text-emerald-700" : col.isMla ? "bg-blue-50/40 text-gray-700" : ""}`}>{display}</td>;
                  })}
                </tr>
              ); })}
              <tr className="bg-gray-50 font-bold">
                <td className="px-3 py-2.5 text-gray-900">TOTAL / 100</td>
                {columns.map((col) => {
                  if (col.isMla && !col.assessed) return <td key={col.id} className="px-3 py-2.5 text-center bg-blue-50/60 text-gray-400 font-semibold">Not Assessed</td>;
                  const hi = Number(col.total) === maxTotal && maxTotal > 0;
                  return <td key={col.id} className={`px-3 py-2.5 text-center ${hi ? "bg-amber-100 text-amber-800" : col.isMla ? "bg-blue-50/60 text-[#164FA3]" : "text-[#164FA3]"}`}>{col.total}</td>;
                })}
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

      <Recommendation b={b} ranked={ranked} onChange={onChange} flash={flash} fail={fail} />
    </div>
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
function AnalysisTab({ b, onChange, flash, fail }) {
  const [reasons, setReasons] = useState(() => padTo(b.analysis?.reasons_won, 3));
  const [weaknesses, setWeaknesses] = useState(() => padTo(b.analysis?.weaknesses, 10));
  const [strengths, setStrengths] = useState(() => padTo(b.analysis?.strengths, 5));
  const [social, setSocial] = useState(() => seedSocial(b.social));
  const [casteOptions, setCasteOptions] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setReasons(padTo(b.analysis?.reasons_won, 3)); setWeaknesses(padTo(b.analysis?.weaknesses, 10)); setStrengths(padTo(b.analysis?.strengths, 5)); setSocial(seedSocial(b.social));
  }, [b.assembly.id, b.analysis, b.social]);
  // Load the ACTIVE Caste Master so new selections come only from it. Deactivated
  // castes are intentionally excluded here (historical rows still show their
  // stored name via CasteSelect).
  useEffect(() => {
    let alive = true;
    api("/api/leader-assessment/castes?active=1").then((d) => { if (alive) setCasteOptions(d.castes || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  async function saveAnalysis() {
    setSaving(true);
    try { await api(`/api/leader-assessment/assemblies/${b.assembly.id}/analysis`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reasons_won: reasons, weaknesses, strengths }) }); flash("Political analysis saved."); onChange(); }
    catch (e) { fail(e.message); } finally { setSaving(false); }
  }
  // Percentage is validated to a number in [0, 100] (numeric only). Out-of-range
  // input is clamped to the bound; non-numeric input is ignored. We never
  // auto-normalise the set to sum to 100 — user-entered values are kept as-is.
  const setPct = (i, val) => {
    if (String(val).trim() === "") return setSocial((a) => a.map((x, j) => (j === i ? { ...x, percentage: "" } : x)));
    let n = Number(val);
    if (!Number.isFinite(n)) return;
    n = Math.max(0, Math.min(100, n));
    setSocial((a) => a.map((x, j) => (j === i ? { ...x, percentage: n } : x)));
  };
  const combinedPct = social.reduce((s, r) => s + (Number(r.percentage) || 0), 0);
  async function saveSocial() {
    // Keep only rows that carry a community (from the master, or a legacy name).
    const rows = social.filter((r) => r.caste_id != null || String(r.name || "").trim());
    for (const r of rows) {
      const raw = String(r.percentage ?? "").trim();
      if (raw !== "") {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > 100) { fail("Each community percentage must be a number between 0 and 100."); return; }
      }
    }
    // No duplicate community in the list.
    const seen = new Set();
    for (const r of rows) {
      const key = r.caste_id != null ? `id:${r.caste_id}` : `nm:${String(r.name).trim().toLowerCase()}`;
      if (seen.has(key)) { fail(`Duplicate community "${r.name}" — each caste can be listed only once.`); return; }
      seen.add(key);
    }
    const payload = rows.map((r) => ({ caste_id: r.caste_id ?? null, name: r.name, percentage: r.percentage }));
    try { await api(`/api/leader-assessment/assemblies/${b.assembly.id}/social`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: payload }) }); flash("Social profile saved."); onChange(); }
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
      <Card title="Political Analysis" icon={Brain} right={<SaveBtn onClick={saveAnalysis} saving={saving} />}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Order: Weakness → Strength → Winning (values/edit unchanged). */}
          {numbered("Top 10 Weaknesses", weaknesses, setWeaknesses, "bg-red-100 text-red-600")}
          {numbered("Top 5 Strengths", strengths, setStrengths, "bg-[#164FA3]/10 text-[#164FA3]")}
          {numbered("Top 3 Reasons for Winning", reasons, setReasons, "bg-emerald-100 text-emerald-700")}
        </div>
      </Card>
      <Card title="Assembly Social Profile" icon={Users} sub="Top castes / communities. Each community is chosen from the centralized Caste Master; percentages are validated 0–100 and never auto-adjusted. Add new castes on the Caste Master tab." right={<SaveBtn onClick={saveSocial} />}>
        <div className="space-y-3">
          {social.map((row, i) => {
            const pct = Number(row.percentage) || 0;
            return (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs font-bold text-gray-400 w-14 shrink-0">Caste {i + 1}</span>
                <CasteSelect
                  value={{ caste_id: row.caste_id, name: row.name }}
                  options={casteOptions}
                  onPick={(picked) => setSocial((a) => a.map((x, j) => (j === i ? { ...x, caste_id: picked.caste_id, name: picked.name } : x)))}
                />
                <div className="flex-1 hidden sm:block"><div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-[#164FA3] rounded-full" style={{ width: `${Math.min(100, pct)}%` }} /></div></div>
                <div className="relative shrink-0"><input type="number" min={0} max={100} step="0.1" className={`${inp} w-24 pr-6`} placeholder="%" value={row.percentage} onChange={(e) => setPct(i, e.target.value)} /><span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">%</span></div>
                <button onClick={() => setSocial((a) => a.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600 p-1.5 shrink-0" title="Remove"><X size={14} /></button>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
          <button onClick={() => setSocial((a) => [...a, { caste_id: null, name: "", percentage: "" }])} className="inline-flex items-center gap-1 text-sm font-semibold text-[#164FA3] hover:underline"><Plus size={14} /> Add Community</button>
          <div className="text-sm">
            <span className="text-gray-500 mr-2">Combined</span>
            <span className={`font-bold ${combinedPct > 100 ? "text-red-600" : "text-gray-800"}`}>{Math.round(combinedPct * 10) / 10}%</span>
          </div>
        </div>
        {combinedPct > 100 && <div className="text-[11px] text-red-500 mt-1 text-right">The listed percentages add up to over 100%. Values are kept exactly as entered — adjust them if needed.</div>}
      </Card>
    </div>
  );
}

// --------------------------- Caste Master ----------------------------------
// Centralized Caste / Community master management. Admins can Add, Edit, Search,
// and Activate/Deactivate castes. Every caste has a Unique ID, Name, Status and
// Created/Updated timestamps. Deactivating never deletes and never touches
// historical records — it only stops a caste appearing for NEW selections.
function CasteMaster({ flash, fail }) {
  const [castes, setCastes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [editing, setEditing] = useState(null); // null | {} (new) | caste (edit)
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api("/api/leader-assessment/castes");
      setCastes(d.castes || []);
    } catch (e) { fail(e.message); } finally { setLoading(false); }
  }, [fail]);
  useEffect(() => { load(); }, [load]);

  const q = search.trim().toLowerCase();
  const visible = castes.filter((c) => (showInactive || c.is_active) && (!q || c.name.toLowerCase().includes(q)));
  const activeCount = castes.filter((c) => c.is_active).length;

  async function toggleActive(c) {
    setBusyId(c.id);
    try {
      await api(`/api/leader-assessment/castes/${c.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !c.is_active }) });
      flash(c.is_active ? `"${c.name}" deactivated.` : `"${c.name}" activated.`);
      await load();
    } catch (e) { fail(e.message); } finally { setBusyId(null); }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total Castes" value={castes.length} />
        <Stat label="Active" value={activeCount} />
        <Stat label="Deactivated" value={castes.length - activeCount} />
        <Stat label="In Use" value={castes.filter((c) => c.usage_count > 0).length} hint="Referenced by a social profile" />
      </div>

      <Card
        title="Caste / Community Master"
        icon={Database}
        sub="The single source of truth for every Caste / Community used in Leader Assessment. Add, edit, search and activate/deactivate here."
        right={<button onClick={() => setEditing({})} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-3.5 py-2 rounded-lg text-sm font-semibold"><Plus size={15} /> Add Caste</button>}
      >
        <div className="flex items-center gap-3 flex-wrap mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search castes / communities…" className={`${inp} pl-9`} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 select-none cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded border-gray-300" />
            Show deactivated
          </label>
        </div>

        {loading ? (
          <div className="py-10 flex items-center justify-center text-gray-400"><Loader2 className="animate-spin mr-2" size={18} /> Loading…</div>
        ) : visible.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">{castes.length === 0 ? "No castes yet. Click “Add Caste” to create the first one." : "No castes match your search."}</div>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="py-2 pr-3 w-16">ID</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3 w-24">Status</th>
                  <th className="py-2 pr-3 w-20">Used</th>
                  <th className="py-2 pr-3 w-36">Created</th>
                  <th className="py-2 pr-3 w-36">Updated</th>
                  <th className="py-2 pr-3 w-40 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="py-2.5 pr-3 text-gray-400 font-mono text-xs">#{c.id}</td>
                    <td className="py-2.5 pr-3 font-semibold text-gray-800">{c.name}</td>
                    <td className="py-2.5 pr-3">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${c.is_active ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{c.is_active ? "Active" : "Deactivated"}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-gray-500">{c.usage_count}</td>
                    <td className="py-2.5 pr-3 text-gray-500 text-xs">{fmtDateTime(c.created_at)}</td>
                    <td className="py-2.5 pr-3 text-gray-500 text-xs">{fmtDateTime(c.updated_at)}</td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setEditing(c)} className="text-gray-500 hover:text-[#164FA3] p-1.5 rounded-md hover:bg-blue-50" title="Edit"><Pencil size={15} /></button>
                        <button onClick={() => toggleActive(c)} disabled={busyId === c.id} className={`p-1.5 rounded-md ${c.is_active ? "text-gray-500 hover:text-red-600 hover:bg-red-50" : "text-gray-500 hover:text-emerald-600 hover:bg-emerald-50"}`} title={c.is_active ? "Deactivate" : "Activate"}>
                          {busyId === c.id ? <Loader2 size={15} className="animate-spin" /> : c.is_active ? <Power size={15} /> : <Check size={15} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && <CasteEditor caste={editing} existing={castes} onClose={() => setEditing(null)} onSaved={(msg) => { setEditing(null); flash(msg); load(); }} fail={fail} />}
    </div>
  );
}

function CasteEditor({ caste, existing, onClose, onSaved, fail }) {
  const isNew = !caste?.id;
  const [name, setName] = useState(caste?.name || "");
  const [active, setActive] = useState(caste?.is_active !== false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Live client-side duplicate hint (case-insensitive) so the admin sees the
  // clash before submitting; the server enforces it authoritatively too.
  const norm = name.replace(/\s+/g, " ").trim().toLowerCase();
  const dup = norm && (existing || []).some((c) => c.id !== caste?.id && c.name.trim().toLowerCase() === norm);

  async function save() {
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean) { setErr("Caste / community name is required."); return; }
    if (dup) { setErr(`"${clean}" already exists in the caste master.`); return; }
    setSaving(true); setErr("");
    try {
      if (isNew) {
        await api("/api/leader-assessment/castes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: clean, is_active: active }) });
        onSaved(`"${clean}" added to the caste master.`);
      } else {
        await api(`/api/leader-assessment/castes/${caste.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: clean, is_active: active }) });
        onSaved(`"${clean}" updated.`);
      }
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <Modal title={isNew ? "Add Caste / Community" : "Edit Caste / Community"} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={lbl}>Name <span className="text-red-500">*</span></label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !dup) save(); }} placeholder="e.g. Yadav, Sahu, Satnami…" className={inp} />
          {dup && <div className="text-[11px] text-amber-600 mt-1">This name already exists in the caste master.</div>}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 select-none cursor-pointer">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="rounded border-gray-300" />
          Active <span className="text-gray-400">(available for new selections)</span>
        </label>
        {!isNew && caste?.usage_count > 0 && !active && (
          <div className="text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-2.5">
            This caste is used by {caste.usage_count} record{caste.usage_count === 1 ? "" : "s"}. Deactivating keeps every existing record valid and unchanged — it only removes the caste from new selection lists.
          </div>
        )}
        {err && <div className="text-sm text-red-600">{err}</div>}
      </div>
      <ModalActions onClose={onClose} onSave={save} saving={saving} />
    </Modal>
  );
}

// Searchable single-select bound to the ACTIVE Caste Master (plus, when editing a
// historical row, its own possibly-deactivated caste so the value still shows).
// Emits { caste_id, name } on pick. `value` = { caste_id, name }.
function CasteSelect({ value, options, onPick, placeholder = "Select community / caste" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const label = value?.name || "";
  const ql = q.trim().toLowerCase();
  const list = (options || []).filter((c) => !ql || c.name.toLowerCase().includes(ql));
  // A historical caste that's been deactivated won't be in `options`; surface it
  // (disabled) so the reader still understands what's stored.
  const historicalMissing = value?.caste_id != null && !(options || []).some((c) => c.id === value.caste_id);

  return (
    <div className="relative max-w-xs w-full">
      <button type="button" onClick={() => { setOpen((o) => !o); setQ(""); }} className={`${inp} flex items-center justify-between gap-2 text-left`}>
        <span className={label ? "text-gray-800 truncate" : "text-gray-400"}>{label || placeholder}</span>
        <ChevronDown size={15} className="text-gray-400 shrink-0" />
      </button>
      {historicalMissing && <div className="text-[10px] text-amber-600 mt-0.5">Recorded value (this caste is now deactivated)</div>}
      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="absolute z-[61] mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
            <div className="p-2 sticky top-0 bg-white border-b border-gray-100">
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className={`${inp} text-sm py-1.5`} />
            </div>
            {list.length === 0 ? (
              <div className="px-3 py-3 text-sm text-gray-400">No active castes match. Add it on the Caste Master tab.</div>
            ) : list.map((c) => (
              <button key={c.id} type="button" onClick={() => { onPick({ caste_id: c.id, name: c.name }); setOpen(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between gap-2 ${value?.caste_id === c.id ? "bg-blue-50/60 font-semibold text-[#164FA3]" : "text-gray-700"}`}>
                <span className="truncate">{c.name}</span>
                {value?.caste_id === c.id && <Check size={14} className="text-[#164FA3] shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function fmtDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// --------------------------- Polling Station Master ------------------------
// Assembly-wise polling data (Total Booths / Total Voters / Male / Female). Every
// record is keyed to its assembly by ID (never by name), so data is never mixed
// between assemblies. An assembly with no record shows "No polling data available"
// rather than a fake 0. Search/select an assembly, then edit its figures.
function PollingMaster({ flash, fail }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null); // the assembly row being edited

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api("/api/leader-assessment/polling"); setItems(d.items || []); }
    catch (e) { fail(e.message); } finally { setLoading(false); }
  }, [fail]);
  useEffect(() => { load(); }, [load]);

  const q = search.trim().toLowerCase();
  const visible = items.filter((r) => !q || `${r.assembly_name} ${r.district || ""}`.toLowerCase().includes(q));
  const withData = items.filter((r) => r.has_data).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Assemblies" value={items.length} />
        <Stat label="With Polling Data" value={withData} />
        <Stat label="Pending" value={items.length - withData} hint="No polling data yet" />
        <Stat label="Total Voters (all)" value={nfmt(items.reduce((s, r) => s + (Number(r.total_voters) || 0), 0)) || 0} />
      </div>

      <Card
        title="Polling Station Master"
        icon={Building2}
        sub="Assembly-wise polling summary — Total Booths, Total Voters, Male & Female voters. Each record is tied to its Assembly by ID; select an assembly to view or edit only its data."
      >
        <div className="relative max-w-md mb-4">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search assembly or district…" className={`${inp} pl-9`} />
        </div>

        {loading ? (
          <div className="py-10 flex items-center justify-center text-gray-400"><Loader2 className="animate-spin mr-2" size={18} /> Loading…</div>
        ) : visible.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">{items.length === 0 ? "No assemblies found." : "No assemblies match your search."}</div>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="py-2 pr-3">Assembly</th>
                  <th className="py-2 pr-3">District</th>
                  <th className="py-2 pr-3 text-right">Total Booths</th>
                  <th className="py-2 pr-3 text-right">Total Voters</th>
                  <th className="py-2 pr-3 text-right">Male</th>
                  <th className="py-2 pr-3 text-right">Female</th>
                  <th className="py-2 pr-3 text-right w-24">Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.assembly_id} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="py-2.5 pr-3 font-semibold text-gray-800">{r.assembly_name}</td>
                    <td className="py-2.5 pr-3 text-gray-600">{r.district || "—"}</td>
                    {r.has_data ? (
                      <>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{r.total_booths != null ? nfmt(r.total_booths) : "—"}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{r.total_voters != null ? nfmt(r.total_voters) : "—"}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{r.male_voters != null ? nfmt(r.male_voters) : "—"}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{r.female_voters != null ? nfmt(r.female_voters) : "—"}</td>
                      </>
                    ) : (
                      <td colSpan={4} className="py-2.5 pr-3 text-center text-gray-400 italic">No polling data available</td>
                    )}
                    <td className="py-2.5 pr-3 text-right">
                      <button onClick={() => setEditing(r)} className="text-xs font-bold text-[#164FA3] hover:bg-[#164FA3]/10 px-2.5 py-1 rounded-lg inline-flex items-center gap-1"><Pencil size={13} /> {r.has_data ? "Edit" : "Add"}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && <PollingEditor row={editing} onClose={() => setEditing(null)} onSaved={(msg) => { setEditing(null); flash(msg); load(); }} fail={fail} />}
    </div>
  );
}

function PollingEditor({ row, onClose, onSaved, fail }) {
  const [form, setForm] = useState({ total_booths: "", total_voters: "", male_voters: "", female_voters: "" });
  const [meta, setMeta] = useState(null); // { auto_booths, auto_polling_stations }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await api(`/api/leader-assessment/polling/${row.assembly_id}`);
        if (!alive) return;
        const p = d.polling || {};
        setForm({
          total_booths: p.total_booths ?? "",
          total_voters: p.total_voters ?? "",
          male_voters: p.male_voters ?? "",
          female_voters: p.female_voters ?? "",
        });
        setMeta({ auto_booths: p.auto_booths ?? 0, auto_polling_stations: p.auto_polling_stations ?? 0 });
      } catch (e) { setErr(e.message); } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [row.assembly_id]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const num = (v) => { const s = String(v ?? "").trim(); return s === "" ? null : Number(s); };
  const maleFemale = (Number(form.male_voters) || 0) + (Number(form.female_voters) || 0);
  const totalV = num(form.total_voters);
  const exceeds = totalV != null && (form.male_voters !== "" || form.female_voters !== "") && maleFemale > totalV;

  function validate() {
    for (const [k, label] of [["total_booths", "Total Booths"], ["total_voters", "Total Voters"], ["male_voters", "Male Voters"], ["female_voters", "Female Voters"]]) {
      const s = String(form[k] ?? "").trim();
      if (s === "") continue;
      const n = Number(s);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return `${label} must be a whole number (0 or more).`;
    }
    if (exceeds) return "Male + Female voters cannot exceed Total Voters.";
    return "";
  }

  async function save() {
    const v = validate();
    if (v) { setErr(v); return; }
    setSaving(true); setErr("");
    try {
      await api(`/api/leader-assessment/polling/${row.assembly_id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ total_booths: form.total_booths, total_voters: form.total_voters, male_voters: form.male_voters, female_voters: form.female_voters }),
      });
      onSaved(`Polling data saved for ${row.assembly_name}.`);
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <Modal title={`Polling Data · ${row.assembly_name}`} onClose={onClose} wide>
      {loading ? <LoadingBlock /> : (
        <div className="space-y-4">
          <div className="text-sm text-gray-500 flex items-center gap-1.5"><MapPin size={14} className="text-[#164FA3]" /> {row.assembly_name}{row.district ? ` · ${row.district}` : ""}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Field label="Total Booths" type="number" value={form.total_booths} onChange={(v) => set("total_booths", v)} />
              {meta?.auto_booths ? <div className="text-[11px] text-gray-400 mt-0.5">Master location tree currently has {nfmt(meta.auto_booths)} booth{meta.auto_booths === 1 ? "" : "s"}{meta.auto_polling_stations ? `, ${nfmt(meta.auto_polling_stations)} polling station${meta.auto_polling_stations === 1 ? "" : "s"}` : ""}.</div> : null}
            </div>
            <Field label="Total Voters" type="number" value={form.total_voters} onChange={(v) => set("total_voters", v)} />
            <Field label="Male Voters" type="number" value={form.male_voters} onChange={(v) => set("male_voters", v)} />
            <Field label="Female Voters" type="number" value={form.female_voters} onChange={(v) => set("female_voters", v)} />
          </div>
          <div className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-2.5">
            Male + Female = <span className={`font-semibold ${exceeds ? "text-red-600" : "text-gray-700"}`}>{nfmt(maleFemale) || 0}</span>
            {totalV != null && <> of Total Voters <span className="font-semibold text-gray-700">{nfmt(totalV) || 0}</span></>}
            . Leave a field blank if unknown — blanks are stored as no value, not 0.
          </div>
          {err && <div className="text-sm text-red-600">{err}</div>}
        </div>
      )}
      <ModalActions onClose={onClose} onSave={save} saving={saving || loading} />
    </Modal>
  );
}

// ------------------------------- helpers ----------------------------------
function Modal({ title, onClose, children, wide, size }) {
  const width = size === "full" ? "max-w-5xl" : wide ? "max-w-2xl" : "max-w-lg";
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`bg-white rounded-2xl shadow-xl w-full ${width} p-6 max-h-[90vh] overflow-auto`}>
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
function seedSocial(social) { return social?.length ? social.map((s) => ({ caste_id: s.caste_id ?? null, name: s.name || "", percentage: s.percentage ?? "" })) : [{ caste_id: null, name: "", percentage: "" }, { caste_id: null, name: "", percentage: "" }, { caste_id: null, name: "", percentage: "" }]; }
function ageOf(dob) {
  if (!dob) return null; const d = new Date(dob); if (isNaN(d.getTime())) return null;
  const now = new Date(); let age = now.getFullYear() - d.getFullYear(); const mo = now.getMonth() - d.getMonth();
  if (mo < 0 || (mo === 0 && now.getDate() < d.getDate())) age--; return age >= 0 && age < 130 ? age : null;
}
// A person's displayable age: prefer an official stored `age` value if the
// record carries one, else derive it from the stored date_of_birth (never a
// guess). Returns the number or null.
function personAge(p) {
  if (p == null) return null;
  if (p.age != null && p.age !== "") return Number(p.age);
  return ageOf(p.date_of_birth);
}
// "Age: 27" / "Age: —" label shown directly under a candidate/MLA name.
function AgeLine({ person }) {
  const a = personAge(person);
  return <div className="text-[11px] text-gray-500 font-normal">Age: {a != null ? a : "—"}</div>;
}
