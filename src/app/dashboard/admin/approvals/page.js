"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Loader2, ShieldCheck, CheckCircle2, Clock, Lock, XCircle, Search, Plus, X, Award, Stamp, ChevronRight,
  Filter, Phone, MapPin, User as UserIcon, AlertTriangle, RotateCcw, Printer, History as HistoryIcon, Undo2,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import Avatar from "@/components/Avatar";

const BRAND = "#164FA3";
const sel = "h-9 rounded-lg border border-gray-200 text-sm px-2 text-gray-700 bg-white max-w-[190px]";
const inp = "h-10 rounded-lg border border-gray-200 text-sm px-3 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-100";

function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

// Overall status of a record, in the spec's vocabulary.
function overallStatus(a, levels) {
  if (a.status === "final_approved") return { text: "Final Approved", cls: "bg-green-50 text-green-700 border-green-200" };
  if (a.status === "rejected") return { text: "Rejected", cls: "bg-red-50 text-red-700 border-red-200" };
  if (a.status === "returned") return { text: "Returned for Correction", cls: "bg-orange-50 text-orange-700 border-orange-200" };
  const lbl = levels?.find((l) => l.level === a.current_level)?.label;
  return { text: `Pending · Stage ${a.current_level}${lbl ? ` · ${lbl}` : ""}`, cls: "bg-amber-50 text-amber-700 border-amber-200" };
}

// Stage labels used consistently everywhere.
const STAGE = {
  approved: { text: "Approved", cls: "text-green-700", dot: "bg-green-500" },
  pending: { text: "Pending", cls: "text-amber-600", dot: "bg-amber-400" },
  waiting: { text: "Waiting", cls: "text-gray-400", dot: "bg-gray-200" },
  rejected: { text: "Rejected", cls: "text-red-600", dot: "bg-red-500" },
  returned: { text: "Returned for Correction", cls: "text-orange-600", dot: "bg-orange-400" },
  legacy: { text: "Carried over (pre-dates this stage)", cls: "text-slate-500", dot: "bg-slate-300" },
};
function stageIcon(s) {
  if (s === "approved") return <CheckCircle2 size={16} className="text-green-600" />;
  if (s === "pending") return <Clock size={16} className="text-amber-500" />;
  if (s === "rejected") return <XCircle size={16} className="text-red-600" />;
  if (s === "returned") return <Undo2 size={16} className="text-orange-500" />;
  if (s === "legacy") return <CheckCircle2 size={16} className="text-slate-300" />;
  return <Lock size={14} className="text-gray-300" />;
}
const ACTION_LABEL = {
  submitted: "Submitted", approved: "Approved", final_approved: "Final Approved", rejected: "Rejected",
  returned: "Returned for Correction", resubmitted: "Resubmitted", restarted: "Restarted", certificate_issued: "Certificate Issued",
};

function Card({ label, value, tone }) {
  const cls = { brand: "bg-[#164FA3] text-white", green: "bg-white border border-green-200", amber: "bg-white border border-amber-200", blue: "bg-white border border-blue-200" }[tone] || "bg-white border border-gray-200";
  const val = tone === "brand" ? "text-white" : "text-gray-900";
  const lab = tone === "brand" ? "text-blue-100" : "text-gray-500";
  return (
    <div className={`${cls} rounded-xl p-4 shadow-sm`}>
      <div className={`text-2xl font-bold ${val}`}>{value == null ? "—" : Number(value).toLocaleString("en-IN")}</div>
      <div className={`text-xs font-medium mt-1 ${lab}`}>{label}</div>
    </div>
  );
}

// Eight small dots = the full chain at a glance (hover for each stage).
function Progress({ stages, levels }) {
  return (
    <div className="flex items-center gap-1" aria-label="Approval progress">
      {(stages || []).map((s) => (
        <span key={s.level} title={`Stage ${s.level} · ${levels?.find((l) => l.level === s.level)?.label || ""} — ${(STAGE[s.status] || STAGE.waiting).text}${s.approver_name ? ` (${s.approver_name})` : ""}`}
          className={`w-2.5 h-2.5 rounded-full ${(STAGE[s.status] || STAGE.waiting).dot}`} />
      ))}
    </div>
  );
}

export default function ApprovalsPage() {
  const { status } = useSession();
  const router = useRouter();
  const [view, setView] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [initiate, setInitiate] = useState(false);
  const [toast, setToast] = useState(null);
  // filters
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [f, setF] = useState({ status: "", level: "", designation_id: "", assembly_id: "", district_id: "", lok_sabha_id: "", from: "", to: "" });
  const [opts, setOpts] = useState({ designations: [], assemblies: [], districts: [], lokSabhas: [] });

  const flash = (type, text) => { setToast({ type, text }); setTimeout(() => setToast(null), 3500); };
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(t); }, [q]);

  // Filter option lists come from the masters (nothing hard-coded).
  useEffect(() => {
    const get = (u) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    Promise.all([get("/api/designations"), get("/api/locations?type=assembly"), get("/api/locations?type=district"), get("/api/locations?type=lok_sabha")])
      .then(([d, a, di, l]) => setOpts({ designations: d.designations || [], assemblies: a.locations || [], districts: di.locations || [], lokSabhas: l.locations || [] }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setLoadErr("");
    try {
      const p = new URLSearchParams();
      if (view) p.set("view", view);
      if (debounced.trim()) p.set("q", debounced.trim());
      Object.entries(f).forEach(([k, v]) => { if (v) p.set(k, v); });
      const r = await fetch(`/api/designation-approvals?${p}`, { cache: "no-store" });
      if (r.status === 403) { setForbidden(true); return; }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setLoadErr(j.message || "Could not load designation approvals."); return; }
      setData(j); setForbidden(false);
      if (!view) setView(j.meta?.view || "pending");
    } catch { setLoadErr("Network error — could not load designation approvals."); }
    finally { setLoading(false); }
  }, [view, debounced, f]);
  useEffect(() => { if (status === "authenticated") load(); }, [status, load]);

  const meta = data?.meta;
  const counts = data?.counts || {};
  const rows = data?.assignments || [];
  const levels = meta?.levels || [];

  const tabs = useMemo(() => {
    const t = [];
    if (meta?.my_levels?.length) t.push({ key: "pending", label: "Pending My Approval" });
    t.push({ key: "processed", label: "Processed by Me" });
    t.push({ key: "initiated", label: "Submitted by Me" });
    t.push({ key: "final", label: "Final Approved" });
    t.push({ key: "closed", label: "Rejected / Returned" });
    if (meta?.can_view_all) t.push({ key: "all", label: "All Designation Records" });
    return t;
  }, [meta]);

  if (status === "loading") return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  if (forbidden) {
    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center">
        <div className="max-w-md w-full bg-white border border-gray-200 rounded-2xl shadow-sm p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4"><ShieldCheck size={26} /></div>
          <h2 className="text-lg font-bold text-gray-900">Access Denied</h2>
          <p className="text-sm text-gray-500 mt-2">You do not have access to the Designation Approval module.</p>
          <button onClick={() => router.push("/dashboard")} className="mt-6 h-10 px-5 rounded-lg text-white text-sm font-semibold" style={{ background: BRAND }}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  const setFilter = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const anyFilter = q || Object.values(f).some(Boolean);

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <PageHeader icon={ShieldCheck} title="Designation Approval"
        description="Every designation runs through eight sequential approvals — from Vidhansabha Prabhari to Prabhari Ji — before it becomes final."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "Designation Approval" }]} />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card label="Pending My Approval" value={counts.pending_my_approval} tone="brand" />
        <Card label="Processed by Me" value={counts.processed_by_me} tone="blue" />
        <Card label="Awaiting Final Approval" value={counts.awaiting_final_approval} tone="amber" />
        <Card label="Final Approved" value={counts.final_approved} tone="green" />
        <Card label="Certificate Issued" value={counts.certificate_issued} tone="green" />
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1 border-b border-gray-200 -mb-px overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setView(t.key)}
              className={`px-3.5 py-2 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap ${view === t.key ? "border-[#164FA3] text-[#164FA3]" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
              {t.label}
            </button>
          ))}
        </div>
        {meta?.can_initiate && (
          <button onClick={() => setInitiate(true)} className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-white text-sm font-semibold" style={{ background: BRAND }}>
            <Plus size={16} /> Initiate Designation
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <Filter size={15} className="text-gray-400" />
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, mobile number, designation…" className="w-full pl-8 pr-2 h-9 rounded-lg border border-gray-200 text-sm" />
        </div>
        <select value={f.designation_id} onChange={setFilter("designation_id")} className={sel}>
          <option value="">All designations</option>
          {opts.designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={f.assembly_id} onChange={setFilter("assembly_id")} className={sel}>
          <option value="">All assemblies</option>
          {opts.assemblies.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={f.district_id} onChange={setFilter("district_id")} className={sel}>
          <option value="">All districts</option>
          {opts.districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={f.lok_sabha_id} onChange={setFilter("lok_sabha_id")} className={sel}>
          <option value="">All Lok Sabhas</option>
          {opts.lokSabhas.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={f.status} onChange={setFilter("status")} className={sel}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="final_approved">Final Approved</option>
          <option value="rejected">Rejected</option>
          <option value="returned">Returned for Correction</option>
        </select>
        <select value={f.level} onChange={setFilter("level")} className={sel}>
          <option value="">All stages</option>
          {levels.map((l) => <option key={l.level} value={l.level}>Stage {l.level} · {l.label}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-500">From <input type="date" value={f.from} onChange={setFilter("from")} className={`${sel} px-1.5`} /></label>
        <label className="flex items-center gap-1 text-xs text-gray-500">To <input type="date" value={f.to} onChange={setFilter("to")} className={`${sel} px-1.5`} /></label>
        {anyFilter && (
          <button onClick={() => { setQ(""); setF({ status: "", level: "", designation_id: "", assembly_id: "", district_id: "", lok_sabha_id: "", from: "", to: "" }); }}
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"><X size={13} /> Clear</button>
        )}
      </div>

      {loadErr && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{loadErr}</div>}

      {/* List */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-semibold">Worker / Member</th>
                <th className="px-4 py-3 font-semibold">Given Designation</th>
                <th className="px-4 py-3 font-semibold">Assembly · Lok Sabha · Block</th>
                <th className="px-4 py-3 font-semibold">Submitted</th>
                {view === "processed" && <th className="px-4 py-3 font-semibold">My Action</th>}
                <th className="px-4 py-3 font-semibold">Approval Status</th>
                <th className="px-4 py-3 font-semibold text-right">Certificate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-gray-400"><Loader2 className="animate-spin inline" size={22} /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-gray-400">No designation records here.</td></tr>
              ) : rows.map((a, i) => {
                const st = overallStatus(a, levels);
                return (
                  <tr key={`${a.id}:${a.my_action_at || ""}:${i}`} className="hover:bg-gray-50 cursor-pointer" onClick={() => setDetailId(a.id)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={a.member_name || "?"} src={a.member_photo_url} size={36} />
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 truncate">{a.member_name || "—"}</div>
                          {a.member_phone && <div className="text-[11px] text-gray-400 font-mono">{a.member_phone}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{a.designation_name || "—"}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {[a.assembly_name, a.lok_sabha_name, a.block_name].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      <div>{a.assigned_by_name || "—"}</div>
                      <div className="text-gray-400">{fmtDate(a.created_at)}</div>
                    </td>
                    {view === "processed" && (
                      <td className="px-4 py-3 text-xs text-gray-600">
                        <div className="font-medium">{ACTION_LABEL[a.my_action] || a.my_action} · Stage {a.my_level}</div>
                        <div className="text-gray-400">{fmtDate(a.my_action_at)}</div>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.text}</span>
                      <div className="mt-1.5"><Progress stages={a.stages} levels={levels} /></div>
                      {a.missing_approver && (
                        <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-red-600" title={a.missing_approver_message}>
                          <AlertTriangle size={12} /> No approver mapped
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {a.certificate_status === "issued" ? <span className="inline-flex items-center gap-1 text-green-700 text-xs font-semibold"><Award size={14} /> Issued</span>
                        : a.status === "final_approved" ? <span className="text-amber-600 text-xs font-medium">Available</span>
                        : <span className="text-gray-400 text-xs">Not available</span>}
                      <ChevronRight size={15} className="inline ml-1 text-gray-300" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {detailId && <DetailModal id={detailId} onClose={() => setDetailId(null)} onChanged={load} flash={flash} designations={opts.designations} />}
      {initiate && <InitiateModal onClose={() => setInitiate(false)} onDone={(existing) => { setInitiate(false); load(); flash("success", existing ? "This designation is already awaiting approval." : "Designation submitted for approval."); }} flash={flash} />}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[140] px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 ${toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.type === "success" ? <CheckCircle2 size={16} /> : <X size={16} />} {toast.text}
        </div>
      )}
    </div>
  );
}

// ---- Detail: record, timeline, history, actions, certificate ---------------
function DetailModal({ id, onClose, onChanged, flash, designations }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [signature, setSignature] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null); // null | reject | return | resubmit
  const [reason, setReason] = useState("");
  const [newDesig, setNewDesig] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showCert, setShowCert] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await fetch(`/api/designation-approvals/${id}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.message || "Could not load this record."); setD(null); } else setD(j);
    } catch { setErr("Network error."); } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // One request helper: confirm → POST → refresh. The backend re-checks everything.
  async function act(path, body, okMsg) {
    setBusy(true);
    try {
      const r = await fetch(`/api/designation-approvals/${id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { flash("error", j.message || "That action could not be completed."); await load(); return false; }
      flash("success", typeof okMsg === "function" ? okMsg(j) : okMsg);
      setMode(null); setReason(""); setNewDesig(""); setSignature(""); setRemarks("");
      await load(); onChanged();
      return true;
    } finally { setBusy(false); }
  }
  const approve = () => {
    if (!signature.trim()) { flash("error", "Please provide your signature / confirmation to approve."); return; }
    if (!window.confirm(`Approve Stage ${a.current_level} (${d.current_level_label}) for ${a.member_name}?`)) return;
    act("approve", { signature: signature.trim(), remarks: remarks.trim() }, (j) => (j.finalized ? "Final approval complete — the designation is now FINAL APPROVED." : "Approved."));
  };
  const reject = () => {
    if (!reason.trim()) { flash("error", "A reason is required."); return; }
    if (!window.confirm("Reject this designation? This closes it.")) return;
    act("reject", { reason: reason.trim() }, "Rejected.");
  };
  const giveBack = () => {
    if (!reason.trim()) { flash("error", "A reason is required."); return; }
    if (!window.confirm("Return this designation to the submitter for correction?")) return;
    act("return", { reason: reason.trim() }, "Returned for correction.");
  };
  const resubmit = () => {
    if (a.status === "pending" && !reason.trim()) { flash("error", "A reason is required to change a designation that is already in approval."); return; }
    if (!window.confirm("Resubmit? The approval process restarts from Stage 1.")) return;
    act("resubmit", { designation_id: newDesig || undefined, reason: reason.trim() }, "Resubmitted — approval restarted from Stage 1.");
  };

  const a = d?.assignment;
  const tl = d?.timeline || [];
  const hist = d?.history || [];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={a?.member_name || "?"} src={a?.member_photo_url} size={52} />
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-gray-900 truncate">{a?.designation_name || "Designation"}</h3>
              <div className="text-sm text-gray-500 mt-0.5 flex items-center gap-3 flex-wrap">
                <span className="inline-flex items-center gap-1"><UserIcon size={13} /> {a?.member_name || "—"}</span>
                {a?.member_phone && <span className="inline-flex items-center gap-1"><Phone size={13} /> {a.member_phone}</span>}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400"><X size={20} /></button>
        </div>

        <div className="overflow-y-auto px-6 py-4 space-y-4">
          {loading ? <div className="py-10 text-center text-gray-400"><Loader2 className="animate-spin inline" size={22} /></div>
            : err ? <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{err}</div>
            : !a ? null : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${overallStatus(a, tl.map((s) => ({ level: s.level, label: s.role }))).cls}`}>{overallStatus(a, tl.map((s) => ({ level: s.level, label: s.role }))).text}</span>
                <span className="text-xs text-gray-500">Final approval: <b>{a.status === "final_approved" ? "Final Approved" : "Pending"}</b></span>
                <span className="text-xs text-gray-500">Certificate: <b>{a.certificate_status === "issued" ? "Issued" : a.status === "final_approved" ? "Available" : "Not Available"}</b></span>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-600 rounded-xl border border-gray-100 p-3">
                <div><span className="text-gray-400">Assembly:</span> {a.assembly_name || "—"}</div>
                <div><span className="text-gray-400">District:</span> {a.district_name || "—"}</div>
                <div><span className="text-gray-400">Lok Sabha:</span> {a.lok_sabha_name || "—"}</div>
                <div><span className="text-gray-400">Block:</span> {a.block_name || "—"}</div>
                <div><span className="text-gray-400">Submitted by:</span> {a.assigned_by_name || "—"}{a.submitted_by_designation ? ` (${a.submitted_by_designation})` : ""}</div>
                <div><span className="text-gray-400">Submitted:</span> {fmtDate(a.created_at)}</div>
                {a.status === "final_approved" && <div className="col-span-2"><span className="text-gray-400">Final approval:</span> {a.final_approved_by_name || "—"} · {fmtDate(a.final_approved_at)}</div>}
              </div>

              {d.missing_approver && (
                <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" /> <span><b>No approver mapped.</b> {d.missing_approver} Assign the approver (Page Access grant + location) to continue.</span></div>
              )}

              {/* Timeline */}
              <div className="border border-gray-100 rounded-xl divide-y divide-gray-100">
                <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 rounded-t-xl">Approval Timeline</div>
                {tl.map((s) => {
                  const lab = STAGE[s.status] || STAGE.waiting;
                  return (
                    <div key={s.level} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="w-6 text-center">{stageIcon(s.status)}</div>
                      <div className="w-14 text-xs text-gray-400 font-mono">Stage {s.level}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900">{s.role}</div>
                        {s.approver_name && <div className="text-[11px] text-gray-500">{s.approver_name}{s.signature ? ` · ✍ ${s.signature}` : ""}</div>}
                        {s.remarks && s.status !== "legacy" && <div className="text-[11px] text-gray-400">“{s.remarks}”</div>}
                      </div>
                      <div className="text-[11px] text-right w-40 shrink-0">
                        <span className={`${lab.cls} font-medium`}>{lab.text}</span>
                        {s.approved_at && s.status !== "legacy" && <div className="text-gray-400">{fmtDate(s.approved_at)}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {(a.status === "rejected" && a.rejected_reason) && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">Rejected: {a.rejected_reason}</div>}
              {(a.status === "returned" && a.returned_reason) && <div className="rounded-lg bg-orange-50 border border-orange-200 text-orange-700 text-sm px-3 py-2">Returned for correction: {a.returned_reason}</div>}

              {/* Approver controls — shown only when THIS user may act on the current stage (server re-checks). */}
              {d.can_approve_now && (
                <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 space-y-2">
                  <div className="text-sm font-semibold text-gray-900">You are the {d.current_level_label} — Stage {a.current_level}{a.current_level === tl.length ? " (final approval)" : ""}</div>
                  <input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="Signature / confirmation (required)" className={`${inp} w-full`} />
                  <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Remarks (optional)" className={`${inp} w-full`} />
                  <div className="flex flex-wrap gap-2">
                    <button onClick={approve} disabled={busy} className="h-9 px-4 rounded-lg text-white text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60" style={{ background: BRAND }}>
                      {busy ? <Loader2 size={15} className="animate-spin" /> : <Stamp size={15} />} {a.current_level === tl.length ? "Give Final Approval" : "Approve"}
                    </button>
                    <button onClick={() => setMode(mode === "return" ? null : "return")} disabled={busy} className="h-9 px-4 rounded-lg border border-orange-200 text-orange-600 text-sm font-medium hover:bg-orange-50">Return for Correction</button>
                    <button onClick={() => setMode(mode === "reject" ? null : "reject")} disabled={busy} className="h-9 px-4 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50">Reject</button>
                  </div>
                  {(mode === "reject" || mode === "return") && (
                    <div className="flex gap-2 pt-1">
                      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`Reason to ${mode === "reject" ? "reject" : "return"} (required)`} className={`${inp} flex-1`} />
                      <button onClick={mode === "reject" ? reject : giveBack} disabled={busy} className={`h-9 px-4 rounded-lg text-white text-sm font-semibold ${mode === "reject" ? "bg-red-600" : "bg-orange-500"}`}>Confirm</button>
                    </div>
                  )}
                </div>
              )}

              {/* Resubmit / revise (submitter or admin) */}
              {d.can_resubmit && a.status !== "final_approved" && (
                <div className="rounded-xl border border-gray-200 p-4 space-y-2">
                  <button onClick={() => setMode(mode === "resubmit" ? null : "resubmit")} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#164FA3]"><RotateCcw size={15} /> {a.status === "pending" ? "Revise designation" : "Resubmit for approval"}</button>
                  {mode === "resubmit" && (
                    <div className="space-y-2">
                      <p className="text-[11px] text-gray-500">Resubmitting restarts the approval from Stage 1. Earlier actions stay in the history.</p>
                      <select value={newDesig} onChange={(e) => setNewDesig(e.target.value)} className={`${inp} w-full`}>
                        <option value="">Keep the current designation ({a.designation_name})</option>
                        {designations.map((dg) => <option key={dg.id} value={dg.id}>{dg.name}</option>)}
                      </select>
                      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={a.status === "pending" ? "Reason (required)" : "Note (optional)"} className={`${inp} w-full`} />
                      <button onClick={resubmit} disabled={busy} className="h-9 px-4 rounded-lg text-white text-sm font-semibold disabled:opacity-60" style={{ background: BRAND }}>Resubmit</button>
                    </div>
                  )}
                </div>
              )}

              {/* Certificate — controls exist ONLY after final approval (the API enforces it too). */}
              <div className="rounded-xl border border-gray-100 p-4 flex items-center gap-3">
                <Award size={22} className={a.status === "final_approved" ? "text-amber-500" : "text-gray-300"} />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-900">Certificate</div>
                  {a.certificate_status === "issued"
                    ? <div className="text-xs text-green-700">Issued · {a.certificate_number} · {fmtDate(a.certificate_issued_at)}{a.certificate_issued_by_name ? ` · by ${a.certificate_issued_by_name}` : ""}</div>
                    : a.status === "final_approved"
                    ? <div className="text-xs text-gray-500">Available — all eight approvals are complete.</div>
                    : <div className="text-xs text-gray-400">Not available until Prabhari Ji gives the final approval.</div>}
                </div>
                {a.status === "final_approved" && a.certificate_status !== "issued" && (
                  <button onClick={() => act("certificate", {}, "Certificate issued.")} disabled={busy} className="h-9 px-4 rounded-lg text-white text-sm font-semibold disabled:opacity-60" style={{ background: BRAND }}>Issue Certificate</button>
                )}
                {a.certificate_status === "issued" && (
                  <button onClick={() => setShowCert(true)} className="h-9 px-4 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5"><Printer size={15} /> View / Print</button>
                )}
              </div>

              {/* History */}
              <div>
                <button onClick={() => setShowHistory((v) => !v)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600"><HistoryIcon size={15} /> Full history ({hist.length})</button>
                {showHistory && (
                  <ol className="mt-2 border-l-2 border-gray-100 ml-2 space-y-2">
                    {hist.map((h) => (
                      <li key={h.id} className="pl-3 text-xs">
                        <div className="font-medium text-gray-800">{ACTION_LABEL[h.action] || h.action}{h.stage ? ` · Stage ${h.stage}` : ""}{h.cycle > 1 ? ` · cycle ${h.cycle}` : ""}</div>
                        <div className="text-gray-500">{h.actor_name || "System"}{h.actor_role ? ` (${h.actor_role})` : ""} · {fmtDate(h.action_at)}</div>
                        {h.remarks && <div className="text-gray-400">“{h.remarks}”</div>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {showCert && a && <CertificateView a={a} onClose={() => setShowCert(false)} />}
    </div>
  );
}

// Printable certificate built from the FINAL-APPROVED snapshot (never from editable data).
function CertificateView({ a, onClose }) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4 print:bg-white print:p-0" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="bg-white rounded-2xl max-w-2xl w-full p-8 text-center border-4 border-double border-[#164FA3] print:border-4 print:rounded-none" onClick={(e) => e.stopPropagation()}>
        <div className="text-[#164FA3] text-xs font-semibold tracking-widest uppercase">Aam Aadmi Party · Chhattisgarh</div>
        <h2 className="text-3xl font-bold text-gray-900 mt-2">Certificate of Designation</h2>
        <p className="text-sm text-gray-500 mt-6">This is to certify that</p>
        <div className="text-2xl font-bold text-[#164FA3] mt-1">{a.member_name}</div>
        <p className="text-sm text-gray-500 mt-4">has been duly appointed as</p>
        <div className="text-xl font-semibold text-gray-900 mt-1">{a.designation_name}</div>
        <p className="text-sm text-gray-600 mt-2">{[a.block_name, a.assembly_name, a.district_name, a.lok_sabha_name].filter(Boolean).join(" · ")}</p>
        <div className="grid grid-cols-2 gap-4 mt-8 text-xs text-gray-500">
          <div>Certificate No.<div className="font-mono font-semibold text-gray-800">{a.certificate_number}</div></div>
          <div>Final approval<div className="font-semibold text-gray-800">{fmtDate(a.final_approved_at)}</div><div>{a.final_approved_by_name}</div></div>
        </div>
        <div className="mt-8 flex justify-center gap-2 print:hidden">
          <button onClick={() => window.print()} className="h-9 px-4 rounded-lg text-white text-sm font-semibold inline-flex items-center gap-1.5" style={{ background: BRAND }}><Printer size={15} /> Print / Save as PDF</button>
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-gray-200 text-sm text-gray-700">Close</button>
        </div>
      </div>
    </div>
  );
}

// ---- Initiate: pick a member (contact) + a designation --------------------
function InitiateModal({ onClose, onDone, flash }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [contacts, setContacts] = useState([]);
  const [member, setMember] = useState(null);
  const [designations, setDesignations] = useState([]);
  const [designationId, setDesignationId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { const t = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    fetch("/api/designations", { cache: "no-store" }).then((r) => r.json()).then((d) => setDesignations(d.designations || [])).catch(() => {});
  }, []);
  useEffect(() => {
    if (!debounced.trim() || member) { setContacts([]); return; }
    let alive = true;
    fetch(`/api/contacts?search=${encodeURIComponent(debounced.trim())}&page_size=10`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => { if (alive) setContacts(d.contacts || d.data || []); }).catch(() => {});
    return () => { alive = false; };
  }, [debounced, member]);

  async function submit() {
    if (!member) { flash("error", "Select a member."); return; }
    if (!designationId) { flash("error", "Select a designation."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/designation-approvals", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: member.id, designation_id: designationId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { flash("error", j.message || "Could not submit."); return; }
      onDone(!!j.existing);
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Initiate Designation Approval</h3>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400"><X size={20} /></button>
        </div>
        <p className="text-xs text-gray-500">Submitting starts the eight-stage approval, beginning with the Vidhansabha Prabhari of the member's Assembly. The member record is not changed.</p>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Member / Worker</label>
          {member ? (
            <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50/60 px-3 py-2">
              <div><div className="text-sm font-medium text-gray-900">{member.person_name}</div><div className="text-[11px] text-gray-500">{member.phone_number}{member.assembly_name ? ` · ${member.assembly_name}` : ""}</div></div>
              <button onClick={() => { setMember(null); setQ(""); }} className="text-xs text-gray-500 hover:text-gray-700">Change</button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or phone…" className={`${inp} w-full pl-8`} autoFocus />
              </div>
              {contacts.length > 0 && (
                <div className="mt-1 border border-gray-200 rounded-lg max-h-52 overflow-y-auto divide-y divide-gray-100">
                  {contacts.map((c) => (
                    <button key={c.id} onClick={() => { setMember(c); setContacts([]); }} className="w-full text-left px-3 py-2 hover:bg-gray-50">
                      <div className="text-sm font-medium text-gray-900">{c.person_name}</div>
                      <div className="text-[11px] text-gray-500">{c.phone_number}{c.assembly_name ? ` · ${c.assembly_name}` : ""}</div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Designation / Post</label>
          <select value={designationId} onChange={(e) => setDesignationId(e.target.value)} className={`${inp} w-full`}>
            <option value="">Select a designation</option>
            {designations.map((dg) => <option key={dg.id} value={dg.id}>{dg.name}</option>)}
          </select>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="h-10 px-5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={busy || !member || !designationId} className="h-10 px-5 rounded-lg text-white text-sm font-semibold disabled:opacity-60" style={{ background: BRAND }}>
            {busy ? <Loader2 size={16} className="animate-spin inline" /> : "Submit for Approval"}
          </button>
        </div>
      </div>
    </div>
  );
}
