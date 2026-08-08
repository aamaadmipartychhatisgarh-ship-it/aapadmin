"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import ProfilePhoto from "@/components/ProfilePhoto";
import { useSession } from "next-auth/react";
import { isSuperAdmin } from "@/lib/permissions";
import {
  LayoutDashboard, Building2, UserSquare2, History, Users, ClipboardCheck,
  BarChart3, Brain, Plus, Pencil, Trash2, X, Loader2, Trophy, Medal, Award,
  Search, CheckCircle2, AlertCircle, MapPin,
} from "lucide-react";

// 10 assessment parameters (keys match the DB columns / API).
const PARAMS = [
  { key: "s_nature", label: "Candidate Nature" },
  { key: "s_hardworker", label: "Hard Worker" },
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
  { key: "assemblies", label: "Assemblies", icon: Building2, scoped: false },
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
  const { data: session } = useSession();
  const canDelete = isSuperAdmin(session);
  const [tab, setTab] = useState(() => {
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (TABS.some((x) => x.key === t)) return t;
    }
    return "overview";
  });
  const [assemblies, setAssemblies] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [bundle, setBundle] = useState(null);
  const [loadingBundle, setLoadingBundle] = useState(false);
  const [notice, setNotice] = useState("");
  const [err, setErr] = useState("");
  const flash = (m) => { setNotice(m); setErr(""); };
  const fail = (m) => { setErr(m); setNotice(""); };
  useEffect(() => { if (notice || err) { const t = setTimeout(() => { setNotice(""); setErr(""); }, 3500); return () => clearTimeout(t); } }, [notice, err]);

  const loadAssemblies = useCallback(async () => {
    try {
      const d = await api("/api/leader-assessment/assemblies");
      setAssemblies(d.assemblies || []);
      setSelectedId((cur) => cur ?? (d.assemblies?.[0]?.id ?? null));
    } catch (e) { fail(e.message); }
  }, []);

  const loadBundle = useCallback(async (id) => {
    if (!id) { setBundle(null); return; }
    setLoadingBundle(true);
    try { setBundle(await api(`/api/leader-assessment/assemblies/${id}`)); }
    catch (e) { fail(e.message); setBundle(null); }
    finally { setLoadingBundle(false); }
  }, []);

  useEffect(() => { loadAssemblies(); }, [loadAssemblies]);
  useEffect(() => { loadBundle(selectedId); }, [selectedId, loadBundle]);

  const currentTab = TABS.find((t) => t.key === tab);
  const refresh = () => { loadAssemblies(); loadBundle(selectedId); };

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      {notice && <div className="fixed top-4 right-4 z-[60] flex items-center gap-2 bg-emerald-600 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg"><CheckCircle2 size={16} /> {notice}</div>}
      {err && <div className="fixed top-4 right-4 z-[60] flex items-center gap-2 bg-red-600 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg"><AlertCircle size={16} /> {err}</div>}

      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-[#164FA3]/10 text-[#164FA3] flex items-center justify-center"><UserSquare2 size={22} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Leader Assessment</h1>
          <p className="text-sm text-gray-500">Assembly-wise MLA & AAP candidate assessment.</p>
        </div>
      </div>

      {/* Internal tabs */}
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

      {/* Assembly switcher — drives every assembly-scoped tab */}
      {currentTab?.scoped && (
        <div className="flex items-center gap-3 flex-wrap bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
          <span className="text-sm font-semibold text-gray-600">Select Assembly</span>
          <select value={selectedId || ""} onChange={(e) => setSelectedId(Number(e.target.value) || null)} className={`${inp} max-w-xs`}>
            <option value="">— choose —</option>
            {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}{a.district ? ` · ${a.district}` : ""}</option>)}
          </select>
          {loadingBundle && <Loader2 size={16} className="animate-spin text-[#164FA3]" />}
          {!assemblies.length && <span className="text-sm text-gray-400">No assemblies yet — add one on the Assemblies tab.</span>}
        </div>
      )}

      {tab === "overview" && <Overview onOpen={(id) => { setSelectedId(id); setTab("mla"); }} />}
      {tab === "assemblies" && <Assemblies assemblies={assemblies} canDelete={canDelete} onChange={refresh} flash={flash} fail={fail} onOpen={(id) => { setSelectedId(id); setTab("mla"); }} />}
      {currentTab?.scoped && !selectedId && <Empty msg="Select an assembly above to begin." />}
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

function Empty({ msg }) {
  return <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center text-gray-400">{msg}</div>;
}

function Card({ title, icon: Icon, children, right }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-gray-900 flex items-center gap-2">{Icon && <Icon size={17} className="text-[#164FA3]" />}{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function AssemblyHeader({ a, status }) {
  return (
    <div className="bg-gradient-to-br from-[#164FA3] to-[#0B3A82] rounded-2xl p-5 text-white shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-white/70 font-medium">विधानसभा</div>
          <h2 className="text-2xl font-bold">{a.name}</h2>
          <div className="text-sm text-white/85 flex items-center gap-2 mt-0.5"><MapPin size={13} /> {a.district || "—"}{a.lok_sabha ? ` · ${a.lok_sabha}` : ""}{a.number ? ` · #${a.number}` : ""}</div>
        </div>
        <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${status.ready ? "bg-emerald-400/25 text-emerald-50" : "bg-white/15 text-white/90"}`}>
          {status.ready ? "Assessment Ready" : "Assessment Incomplete"}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
        {[["Total Voters", a.total_voters], ["Polling Stations", a.total_polling_stations], ["Total Booths", a.total_booths], ["District", a.district], ["Lok Sabha", a.lok_sabha]].map(([k, v]) => (
          <div key={k} className="bg-white/10 rounded-xl px-3 py-2">
            <div className="text-[11px] text-white/70">{k}</div>
            <div className="font-bold truncate">{v != null && v !== "" ? (typeof v === "number" ? v.toLocaleString("en-IN") : v) : "—"}</div>
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
  useEffect(() => {
    api("/api/leader-assessment/overview").then(setData).catch(() => {});
    api("/api/leader-assessment/assemblies").then((d) => setAssemblies(d.assemblies || [])).catch(() => {});
  }, []);
  const s = data?.stats;
  const stat = (label, val) => (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="text-2xl font-bold text-gray-900">{val ?? "—"}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {stat("Total Assemblies", s?.total_assemblies)}
        {stat("With MLA Data", s?.assemblies_with_mla)}
        {stat("With AAP Candidates", s?.assemblies_with_candidates)}
        {stat("Total Candidates", s?.total_candidates)}
        {stat("Assessments Done", s?.assessments_completed)}
        {stat("Avg Candidate Score", s?.average_score != null ? `${s.average_score}/100` : "—")}
      </div>

      {data?.top_candidates?.length > 0 && (
        <Card title="Top-Ranked Candidates" icon={Trophy}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.top_candidates.map((c, i) => (
              <div key={c.id} className="flex items-center gap-3 border border-gray-100 rounded-xl p-3">
                <span className="text-lg font-bold text-gray-400 w-6">{i + 1}</span>
                <div className="min-w-0 flex-1"><div className="font-semibold text-gray-900 truncate">{c.name}</div><div className="text-xs text-gray-500 truncate">{c.assembly_name}</div></div>
                <span className="font-bold text-[#164FA3]">{c.total}/100</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Assemblies" icon={Building2}>
        {assemblies.length === 0 ? <div className="text-gray-400 text-sm py-4">No assemblies yet.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>{["Assembly", "Current MLA", "AAP Candidates", "Top Candidate", "Score", ""].map((h) => <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {assemblies.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5"><div className="font-semibold text-gray-900">{a.name}</div><div className="text-xs text-gray-400">{a.district || "—"}</div></td>
                    <td className="px-3 py-2.5 text-gray-700">{a.mla_name || <span className="text-gray-300">No MLA</span>}</td>
                    <td className="px-3 py-2.5">{a.candidate_count}/3</td>
                    <td className="px-3 py-2.5 text-gray-700">{a.top_candidate || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2.5 font-semibold">{a.top_score != null ? `${a.top_score}/100` : "—"}</td>
                    <td className="px-3 py-2.5 text-right"><button onClick={() => onOpen(a.id)} className="text-[#164FA3] font-semibold hover:underline text-xs">Open</button></td>
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

// ------------------------------ ASSEMBLIES --------------------------------
const EMPTY_ASM = { name: "", number: "", district: "", lok_sabha: "", total_voters: "", total_polling_stations: "", total_booths: "", election_year: "", population: "", notes: "" };
function Assemblies({ assemblies, canDelete, onChange, flash, fail, onOpen }) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null); // object or "new"
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return assemblies;
    return assemblies.filter((a) => [a.name, a.number, a.district, a.lok_sabha].some((v) => String(v || "").toLowerCase().includes(s)));
  }, [q, assemblies]);

  async function del(a) {
    if (!confirm(`Delete assembly "${a.name}" and ALL its assessment data? This cannot be undone.`)) return;
    try { await api(`/api/leader-assessment/assemblies/${a.id}`, { method: "DELETE" }); flash("Assembly deleted."); onChange(); }
    catch (e) { fail(e.message); }
  }
  return (
    <Card title="Assemblies" icon={Building2} right={
      <div className="flex items-center gap-2">
        <div className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className={`${inp} pl-8 w-44 h-9`} /></div>
        <button onClick={() => setEditing("new")} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-3 py-2 rounded-lg text-sm font-semibold"><Plus size={15} /> Add Assembly</button>
      </div>
    }>
      {filtered.length === 0 ? <div className="text-gray-400 text-sm py-4">No assemblies found.</div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500"><tr>{["Assembly", "No.", "District", "Lok Sabha", "Voters", "Booths", ""].map((h) => <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2.5 font-semibold text-gray-900">{a.name}</td>
                  <td className="px-3 py-2.5">{a.number || "—"}</td>
                  <td className="px-3 py-2.5">{a.district || "—"}</td>
                  <td className="px-3 py-2.5">{a.lok_sabha || "—"}</td>
                  <td className="px-3 py-2.5">{a.total_voters != null ? Number(a.total_voters).toLocaleString("en-IN") : "—"}</td>
                  <td className="px-3 py-2.5">{a.total_booths ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => onOpen(a.id)} className="text-[#164FA3] text-xs font-semibold hover:underline mr-3">Assessment</button>
                    <button onClick={() => setEditing(a)} className="text-gray-500 hover:text-[#164FA3] p-1"><Pencil size={14} /></button>
                    {canDelete && <button onClick={() => del(a)} className="text-gray-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <AssemblyModal initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); flash("Assembly saved."); onChange(); }} fail={fail} />}
    </Card>
  );
}

function AssemblyModal({ initial, onClose, onSaved, fail }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_ASM, ...(initial || {}) }));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  async function save() {
    if (!form.name.trim()) { fail("Assembly name is required."); return; }
    setSaving(true);
    try {
      const url = initial ? `/api/leader-assessment/assemblies/${initial.id}` : "/api/leader-assessment/assemblies";
      await api(url, { method: initial ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      onSaved();
    } catch (e) { fail(e.message); setSaving(false); }
  }
  const F = ({ k, label, type = "text", full }) => (
    <div className={full ? "col-span-2" : ""}><span className={lbl}>{label}</span><input type={type} className={inp} value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} /></div>
  );
  return (
    <Modal title={initial ? "Edit Assembly" : "Add Assembly"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <F k="name" label="Assembly Name *" full />
        <F k="number" label="Assembly Number" />
        <F k="district" label="District" />
        <F k="lok_sabha" label="Lok Sabha" />
        <F k="election_year" label="Election Year" type="number" />
        <F k="total_voters" label="Total Voters" type="number" />
        <F k="total_polling_stations" label="Polling Stations" type="number" />
        <F k="total_booths" label="Total Booths" type="number" />
        <F k="population" label="Population" type="number" />
        <div className="col-span-2"><span className={lbl}>Notes</span><textarea rows={2} className={inp} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></div>
      </div>
      <ModalActions onClose={onClose} onSave={save} saving={saving} />
    </Modal>
  );
}

// -------------------------------- MLA -------------------------------------
const EMPTY_MLA = { photo_url: "", name: "", phone: "", address: "", date_of_birth: "", caste: "", party: "", net_worth: "", criminal_cases: "", times_won: "", times_contested: "", largest_winning_margin: "", previous_winning_margin: "", party_won_from: "", party_defeated: "" };
function MlaTab({ b, onSaved, fail }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_MLA, ...(b.mla || {}), date_of_birth: b.mla?.date_of_birth ? String(b.mla.date_of_birth).slice(0, 10) : "" }));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm({ ...EMPTY_MLA, ...(b.mla || {}), date_of_birth: b.mla?.date_of_birth ? String(b.mla.date_of_birth).slice(0, 10) : "" }); }, [b.assembly.id, b.mla]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const age = ageOf(form.date_of_birth);
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
  const F = ({ k, label, type = "text", full }) => (
    <div className={full ? "col-span-2" : ""}><span className={lbl}>{label}</span><input type={type} className={inp} value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} /></div>
  );
  return (
    <Card title="Current MLA Profile" icon={UserSquare2} right={<button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-semibold">{saving ? <Loader2 size={14} className="animate-spin" /> : null} Save MLA</button>}>
      <div className="flex flex-col items-center gap-1.5 pb-3">
        <ProfilePhoto name={form.name} src={form.photo_url} size={96} square editable persist={persistPhoto} onChange={(url) => set("photo_url", url || "")} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3]" />
        <span className="text-[11px] text-gray-400">JPG, PNG, WEBP</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <F k="name" label="Name" full />
        <F k="phone" label="Phone" />
        <F k="party" label="Party" />
        <F k="date_of_birth" label="Date of Birth" type="date" />
        <div><span className={lbl}>Age (auto)</span><div className={`${inp} bg-gray-50 text-gray-600`}>{age != null ? `${age} years` : "Age not available"}</div></div>
        <F k="caste" label="Caste" />
        <F k="net_worth" label="Net Worth" />
        <F k="criminal_cases" label="Criminal Cases" type="number" />
        <F k="address" label="Address" full />
      </div>
      <div className="mt-5 pt-4 border-t border-gray-100">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Election Performance</div>
        <div className="grid grid-cols-2 gap-3">
          <F k="times_won" label="Times Won as MLA" type="number" />
          <F k="times_contested" label="Times Contested" type="number" />
          <F k="largest_winning_margin" label="Largest Winning Margin" type="number" />
          <F k="previous_winning_margin" label="Previous Winning Margin" type="number" />
          <F k="party_won_from" label="Party Won From" />
          <F k="party_defeated" label="Party Defeated" />
        </div>
      </div>
    </Card>
  );
}

// ----------------------------- ELECTIONS ----------------------------------
const EMPTY_ELEC = { election_year: "", election_type: "", party: "", candidate: "", status: "", votes: "", vote_percentage: "", margin: "", result: "" };
function ElectionsTab({ b, onChange, flash, fail }) {
  const [editing, setEditing] = useState(null);
  async function del(e) {
    if (!confirm("Remove this election record?")) return;
    try { await api(`/api/leader-assessment/elections/${e.id}`, { method: "DELETE" }); flash("Election removed."); onChange(); } catch (er) { fail(er.message); }
  }
  const last10 = b.elections.slice(0, 10);
  return (
    <Card title="Election History" icon={History} right={<button onClick={() => setEditing("new")} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-3 py-2 rounded-lg text-sm font-semibold"><Plus size={15} /> Add Election</button>}>
      {b.elections.length === 0 ? <div className="text-gray-400 text-sm py-4">No election records yet.</div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500"><tr>{["Year", "Type", "Party", "Candidate", "Result", "Votes", "Vote %", "Margin", ""].map((h) => <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {last10.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2.5 font-semibold">{e.election_year}</td>
                  <td className="px-3 py-2.5">{e.election_type || "—"}</td>
                  <td className="px-3 py-2.5">{e.party || "—"}</td>
                  <td className="px-3 py-2.5">{e.candidate || "—"}</td>
                  <td className="px-3 py-2.5"><ResultBadge v={e.result || e.status} /></td>
                  <td className="px-3 py-2.5">{e.votes != null ? Number(e.votes).toLocaleString("en-IN") : "—"}</td>
                  <td className="px-3 py-2.5">{e.vote_percentage != null ? `${e.vote_percentage}%` : "—"}</td>
                  <td className="px-3 py-2.5">{e.margin != null ? Number(e.margin).toLocaleString("en-IN") : "—"}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(e)} className="text-gray-500 hover:text-[#164FA3] p-1"><Pencil size={14} /></button>
                    <button onClick={() => del(e)} className="text-gray-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {b.elections.length > 10 && <div className="text-xs text-gray-400 mt-2">Showing the latest 10 of {b.elections.length} records.</div>}
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
        <F k="election_year" label="Election Year *" type="number" />
        <F k="election_type" label="Election Type" />
        <F k="party" label="Party" />
        <F k="candidate" label="Candidate" />
        <div><span className={lbl}>Result</span><select className={inp} value={form.result || ""} onChange={(e) => set("result", e.target.value)}><option value="">—</option><option value="Won">Won</option><option value="Lost">Lost</option></select></div>
        <F k="status" label="Status" />
        <F k="votes" label="Votes" type="number" />
        <F k="vote_percentage" label="Vote %" type="number" />
        <F k="margin" label="Margin" type="number" />
      </div>
      <ModalActions onClose={onClose} onSave={save} saving={saving} />
    </Modal>
  );
}

// ----------------------------- CANDIDATES ---------------------------------
const EMPTY_CAND = { photo_url: "", name: "", phone: "", address: "", date_of_birth: "", caste: "", net_worth: "", business: "", monthly_income: "" };
function CandidatesTab({ b, onChange, flash, fail }) {
  const [editing, setEditing] = useState(null);
  async function del(c) {
    if (!confirm(`Remove candidate "${c.name}"?`)) return;
    try { await api(`/api/leader-assessment/candidates/${c.id}`, { method: "DELETE" }); flash("Candidate removed."); onChange(); } catch (e) { fail(e.message); }
  }
  return (
    <Card title="AAP Candidates" icon={Users} right={b.candidates.length < 3 ? <button onClick={() => setEditing("new")} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-3 py-2 rounded-lg text-sm font-semibold"><Plus size={15} /> Add Candidate</button> : <span className="text-xs text-gray-400">Max 3 candidates</span>}>
      {b.candidates.length === 0 ? <div className="text-gray-400 text-sm py-4">No AAP candidates added yet.</div> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {b.candidates.map((c) => (
            <div key={c.id} className="border border-gray-100 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <ProfilePhoto name={c.name} src={c.photo_url} size={52} editable={false} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3]" />
                <div className="min-w-0 flex-1"><div className="font-bold text-gray-900 truncate">{c.name}</div><div className="text-xs text-gray-500">{c.age != null ? `${c.age} yrs` : "Age N/A"}{c.caste ? ` · ${c.caste}` : ""}</div></div>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#164FA3]/10 text-[#164FA3]">{c.total}/100</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3 text-xs">
                <Kv k="Phone" v={c.phone} /><Kv k="Business" v={c.business} />
                <Kv k="Net Worth" v={c.net_worth} /><Kv k="Monthly Income" v={c.monthly_income} />
              </div>
              <div className="flex justify-end gap-1 mt-3">
                <button onClick={() => setEditing(c)} className="text-gray-500 hover:text-[#164FA3] p-1.5"><Pencil size={14} /></button>
                <button onClick={() => del(c)} className="text-gray-400 hover:text-red-600 p-1.5"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <CandidateModal assemblyId={b.assembly.id} initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); flash("Candidate saved."); onChange(); }} fail={fail} />}
    </Card>
  );
}
function Kv({ k, v }) { return <div><span className="text-gray-400">{k}: </span><span className="text-gray-700 font-medium">{v || "—"}</span></div>; }
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
        <ProfilePhoto name={form.name} src={form.photo_url} size={84} square editable persist={persistPhoto} onChange={(url) => set("photo_url", url || "")} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3]" />
        <span className="text-[11px] text-gray-400">JPG, PNG, WEBP</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <F k="name" label="Name *" full />
        <F k="phone" label="Phone" />
        <F k="date_of_birth" label="Date of Birth" type="date" />
        <div><span className={lbl}>Age (auto)</span><div className={`${inp} bg-gray-50 text-gray-600`}>{age != null ? `${age} years` : "Age not available"}</div></div>
        <F k="caste" label="Caste" />
        <F k="net_worth" label="Net Worth" />
        <F k="business" label="Business" />
        <F k="monthly_income" label="Monthly Income" />
        <F k="address" label="Address" full />
      </div>
      <ModalActions onClose={onClose} onSave={save} saving={saving} />
    </Modal>
  );
}

// ---------------------------- ASSESSMENTS ---------------------------------
function AssessmentsTab({ b, onChange, flash, fail }) {
  if (b.candidates.length === 0) return <Empty msg="No AAP candidates added yet. Add candidates first." />;
  return (
    <div className="space-y-4">
      {b.candidates.map((c) => <AssessCard key={c.id} c={c} onChange={onChange} flash={flash} fail={fail} />)}
    </div>
  );
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
    <Card title={c.name} icon={ClipboardCheck} right={<div className="flex items-center gap-3"><span className="text-lg font-bold text-[#164FA3]">{total}/100</span><button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm font-semibold">{saving ? <Loader2 size={14} className="animate-spin" /> : null} Save</button></div>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
        {PARAMS.map((p) => (
          <div key={p.key} className="flex items-center justify-between gap-3">
            <span className="text-sm text-gray-700">{p.label}</span>
            <input type="number" min={0} max={10} value={scores[p.key]} onChange={(e) => setScore(p.key, e.target.value)} className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center outline-none focus:ring-2 focus:ring-[#164FA3]/40" />
          </div>
        ))}
      </div>
    </Card>
  );
}

// ----------------------------- COMPARISON ---------------------------------
function ComparisonTab({ b, onChange, flash, fail }) {
  const ranked = b.candidates; // already ranked by API
  if (ranked.length === 0) return <Empty msg="No AAP candidates to compare yet." />;
  return (
    <div className="space-y-4">
      <Card title="Three-Candidate Comparison" icon={BarChart3}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="px-3 py-2 text-left font-semibold text-gray-500">Parameter</th>{ranked.map((c) => <th key={c.id} className="px-3 py-2 text-center font-semibold text-gray-900">{c.name}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {PARAMS.map((p) => (
                <tr key={p.key}><td className="px-3 py-2 text-gray-600">{p.label}</td>{ranked.map((c) => <td key={c.id} className="px-3 py-2 text-center">{c.assessment?.[p.key] ?? "—"}</td>)}</tr>
              ))}
              <tr className="bg-gray-50 font-bold"><td className="px-3 py-2.5 text-gray-900">TOTAL / 100</td>{ranked.map((c) => <td key={c.id} className="px-3 py-2.5 text-center text-[#164FA3]">{c.total}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Automatic Ranking" icon={Trophy}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {ranked.map((c, i) => {
            const Icon = RANK_ICON[i] || Award;
            return (
              <div key={c.id} className={`rounded-2xl border p-4 text-center ${i === 0 ? "border-[#FCB712] bg-amber-50" : "border-gray-100"}`}>
                <Icon size={26} className={`mx-auto ${RANK_COLOR[i] || "text-gray-400"}`} />
                <div className="text-xs font-bold text-gray-400 mt-1">Rank {c.rank}</div>
                <div className="font-bold text-gray-900 truncate">{c.name}</div>
                <div className="text-lg font-bold text-[#164FA3]">{c.total}/100</div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-gray-400 mt-3">Ranking is computed from total score. Tie-breaker: Winning Ability → Public Acceptability → earliest added.</p>
      </Card>

      <Recommendation b={b} ranked={ranked} onChange={onChange} flash={flash} fail={fail} />
    </div>
  );
}

function Recommendation({ b, ranked, onChange, flash, fail }) {
  const strongest = ranked[0];
  const [form, setForm] = useState(() => ({ mla_biggest_weakness: "", aap_biggest_strength: "", target_community: "", target_booth: "", main_issue: "", ...(b.strategy || {}) }));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm({ mla_biggest_weakness: "", aap_biggest_strength: "", target_community: "", target_booth: "", main_issue: "", ...(b.strategy || {}) }); }, [b.assembly.id, b.strategy]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  async function save() {
    setSaving(true);
    try { await api(`/api/leader-assessment/assemblies/${b.assembly.id}/strategy`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }); flash("Recommendation saved."); onChange(); }
    catch (e) { fail(e.message); } finally { setSaving(false); }
  }
  const F = ({ k, label, area }) => (
    <div><span className={lbl}>{label}</span>{area ? <textarea rows={2} className={inp} value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} /> : <input className={inp} value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} />}</div>
  );
  return (
    <Card title="Final Recommendation" icon={Award} right={<button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm font-semibold">{saving ? <Loader2 size={14} className="animate-spin" /> : null} Save</button>}>
      {strongest && strongest.total > 0 ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-4 flex items-center gap-3">
          <Trophy size={20} className="text-[#FCB712]" />
          <div><div className="text-xs text-emerald-700 font-semibold">Strongest Candidate (auto-selected)</div><div className="font-bold text-gray-900">{strongest.name} — {strongest.total}/100</div></div>
        </div>
      ) : <div className="text-sm text-gray-400 mb-4">Assessment incomplete — no strongest candidate yet.</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <F k="mla_biggest_weakness" label="MLA's Biggest Weakness" area />
        <F k="aap_biggest_strength" label="AAP Candidate's Biggest Strength" area />
        <F k="target_community" label="Target Community / Caste" />
        <F k="target_booth" label="Target Booth" />
        <div className="sm:col-span-2"><span className={lbl}>Main Election Issue</span><textarea rows={2} className={inp} value={form.main_issue ?? ""} onChange={(e) => set("main_issue", e.target.value)} /></div>
      </div>
    </Card>
  );
}

// ----------------------------- ANALYSIS -----------------------------------
function AnalysisTab({ b, onChange, flash, fail }) {
  const [reasons, setReasons] = useState(() => padTo(b.analysis?.reasons_won, 3));
  const [weaknesses, setWeaknesses] = useState(() => padTo(b.analysis?.weaknesses, 10));
  const [strengths, setStrengths] = useState(() => padTo(b.analysis?.strengths, 5));
  const [social, setSocial] = useState(() => (b.social?.length ? b.social.map((s) => ({ name: s.name, percentage: s.percentage ?? "" })) : [{ name: "", percentage: "" }, { name: "", percentage: "" }, { name: "", percentage: "" }]));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setReasons(padTo(b.analysis?.reasons_won, 3)); setWeaknesses(padTo(b.analysis?.weaknesses, 10)); setStrengths(padTo(b.analysis?.strengths, 5));
    setSocial(b.social?.length ? b.social.map((s) => ({ name: s.name, percentage: s.percentage ?? "" })) : [{ name: "", percentage: "" }, { name: "", percentage: "" }, { name: "", percentage: "" }]);
  }, [b.assembly.id, b.analysis, b.social]);

  async function saveAnalysis() {
    setSaving(true);
    try { await api(`/api/leader-assessment/assemblies/${b.assembly.id}/analysis`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reasons_won: reasons, weaknesses, strengths }) }); flash("Political analysis saved."); onChange(); }
    catch (e) { fail(e.message); } finally { setSaving(false); }
  }
  async function saveSocial() {
    try { await api(`/api/leader-assessment/assemblies/${b.assembly.id}/social`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: social }) }); flash("Social structure saved."); onChange(); }
    catch (e) { fail(e.message); }
  }
  const listBlock = (title, items, setItems, count) => (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">{title}</div>
      <div className="space-y-2">
        {items.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-gray-400 w-5 text-right">{i + 1}.</span>
            <input className={inp} value={v} onChange={(e) => setItems((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))} />
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div className="space-y-4">
      <Card title="Political Analysis" icon={Brain} right={<button onClick={saveAnalysis} disabled={saving} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm font-semibold">{saving ? <Loader2 size={14} className="animate-spin" /> : null} Save</button>}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {listBlock("3 Main Reasons MLA Won", reasons, setReasons)}
          {listBlock("5 Major Strengths", strengths, setStrengths)}
          {listBlock("10 Major Weaknesses", weaknesses, setWeaknesses)}
        </div>
      </Card>
      <Card title="Social Structure" icon={Users} right={<button onClick={saveSocial} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-3 py-1.5 rounded-lg text-sm font-semibold">Save</button>}>
        <div className="text-[11px] text-gray-400 mb-2">Top castes / communities (admin-entered).</div>
        <div className="space-y-2">
          {social.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-400 w-14">Rank {i + 1}</span>
              <input className={inp} placeholder="Community / Caste" value={row.name} onChange={(e) => setSocial((a) => a.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input type="number" className={`${inp} w-24`} placeholder="%" value={row.percentage} onChange={(e) => setSocial((a) => a.map((x, j) => (j === i ? { ...x, percentage: e.target.value } : x)))} />
              <button onClick={() => setSocial((a) => a.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600 p-1.5"><X size={14} /></button>
            </div>
          ))}
        </div>
        <button onClick={() => setSocial((a) => [...a, { name: "", percentage: "" }])} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[#164FA3] hover:underline"><Plus size={14} /> Add community</button>
      </Card>
    </div>
  );
}

// ------------------------------- shared -----------------------------------
function ResultBadge({ v }) {
  if (!v) return <span className="text-gray-300">—</span>;
  const won = /won/i.test(v);
  const lost = /lost/i.test(v);
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${won ? "bg-emerald-50 text-emerald-700" : lost ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-600"}`}>{v}</span>;
}
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
function ageOf(dob) {
  if (!dob) return null; const d = new Date(dob); if (isNaN(d.getTime())) return null;
  const now = new Date(); let age = now.getFullYear() - d.getFullYear(); const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--; return age >= 0 && age < 130 ? age : null;
}
