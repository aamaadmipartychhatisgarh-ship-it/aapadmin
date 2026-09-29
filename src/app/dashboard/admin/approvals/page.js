"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Loader2, ShieldCheck, CheckCircle2, Clock, Lock, XCircle, Search, Plus, X, Award,
  Stamp, ChevronRight, Filter, Phone, MapPin, User as UserIcon,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";

const BRAND = "#164FA3";
const sel = "h-9 rounded-lg border border-gray-200 text-sm px-2 text-gray-700 bg-white";
const inp = "h-10 rounded-lg border border-gray-200 text-sm px-3 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-100";

function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}
function overallStatus(a) {
  if (a.status === "final_approved") return { text: "Final Approved", cls: "bg-green-50 text-green-700 border-green-200" };
  if (a.status === "rejected") return { text: "Rejected", cls: "bg-red-50 text-red-700 border-red-200" };
  return { text: `Pending · L${a.current_level}`, cls: "bg-amber-50 text-amber-700 border-amber-200" };
}
function stepIcon(s) {
  if (s === "approved") return <CheckCircle2 size={16} className="text-green-600" />;
  if (s === "pending") return <Clock size={16} className="text-amber-500" />;
  if (s === "rejected") return <XCircle size={16} className="text-red-600" />;
  return <Lock size={14} className="text-gray-300" />;
}

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

export default function ApprovalsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [view, setView] = useState("pending");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [initiate, setInitiate] = useState(false);
  const [toast, setToast] = useState(null);
  // filters
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fLevel, setFLevel] = useState("");

  const flash = (type, text) => { setToast({ type, text }); setTimeout(() => setToast(null), 3000); };

  useEffect(() => { const t = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ view });
      if (debounced.trim()) p.set("q", debounced.trim());
      if (fStatus) p.set("status", fStatus);
      if (fLevel) p.set("level", fLevel);
      const r = await fetch(`/api/designation-approvals?${p}`, { cache: "no-store" });
      if (r.status === 403) { setForbidden(true); return; }
      if (r.ok) { setData(await r.json()); setForbidden(false); }
    } finally { setLoading(false); }
  }, [view, debounced, fStatus, fLevel]);

  useEffect(() => { if (status === "authenticated") load(); }, [status, load]);

  const meta = data?.meta;
  const counts = data?.counts || {};
  const rows = data?.assignments || [];

  const tabs = useMemo(() => {
    const t = [];
    if (meta?.my_levels?.length) t.push({ key: "pending", label: "Pending My Approval" });
    t.push({ key: "approved", label: "My Approved" });
    t.push({ key: "initiated", label: "Initiated by Me" });
    if (meta?.can_view_all) t.push({ key: "all", label: "All Requests" });
    return t;
  }, [meta]);

  if (status === "loading") return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  if (forbidden) {
    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center">
        <div className="max-w-md w-full bg-white border border-gray-200 rounded-2xl shadow-sm p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4"><ShieldCheck size={26} /></div>
          <h2 className="text-lg font-bold text-gray-900">Access Denied</h2>
          <p className="text-sm text-gray-500 mt-2">You do not have access to the Designation Approvals module.</p>
          <button onClick={() => router.push("/dashboard")} className="mt-6 h-10 px-5 rounded-lg text-white text-sm font-semibold" style={{ background: BRAND }}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <PageHeader icon={ShieldCheck} title="Designation Approvals"
        description="Every designation runs through the 7-level approval chain before it becomes final."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "Designation Approvals" }]} />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card label="Pending My Approval" value={counts.pending_my_approval} tone="brand" />
        <Card label="Approved By Me" value={counts.approved_by_me} tone="blue" />
        <Card label="Final Approved" value={counts.final_approved} tone="green" />
        <Card label="Certificate Pending" value={counts.certificate_pending} tone="amber" />
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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search worker, designation, phone…" className="w-full pl-8 pr-2 h-9 rounded-lg border border-gray-200 text-sm" />
        </div>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={sel}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="final_approved">Final Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select value={fLevel} onChange={(e) => setFLevel(e.target.value)} className={sel}>
          <option value="">All levels</option>
          {(meta?.levels || []).map((l) => <option key={l.level} value={l.level}>L{l.level} · {l.label}</option>)}
        </select>
      </div>

      {/* List */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-semibold">Worker</th>
                <th className="px-4 py-3 font-semibold">Designation</th>
                <th className="px-4 py-3 font-semibold">Assembly / District</th>
                {view === "approved" && <th className="px-4 py-3 font-semibold">My Approval</th>}
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Certificate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-16 text-center text-gray-400"><Loader2 className="animate-spin inline" size={22} /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-16 text-center text-gray-400">No designation requests here.</td></tr>
              ) : rows.map((a) => {
                const st = overallStatus(a);
                return (
                  <tr key={a.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setDetailId(a.id)}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{a.member_name || "—"}</div>
                      {a.member_phone && <div className="text-[11px] text-gray-400 font-mono">{a.member_phone}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{a.designation_name || "—"}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{a.assembly_name || "—"}{a.district_name ? ` · ${a.district_name}` : ""}</td>
                    {view === "approved" && <td className="px-4 py-3 text-xs text-gray-600">L{a.my_level} · {fmtDate(a.my_approved_at)}</td>}
                    <td className="px-4 py-3"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.text}</span></td>
                    <td className="px-4 py-3 text-right">
                      {a.certificate_status === "issued" ? <span className="inline-flex items-center gap-1 text-green-700 text-xs font-semibold"><Award size={14} /> Issued</span>
                        : a.status === "final_approved" ? <span className="text-amber-600 text-xs font-medium">Available</span>
                        : <span className="text-gray-300 text-xs">Locked</span>}
                      <ChevronRight size={15} className="inline ml-1 text-gray-300" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {detailId && <DetailModal id={detailId} onClose={() => setDetailId(null)} onChanged={() => { load(); }} flash={flash} />}
      {initiate && <InitiateModal onClose={() => setInitiate(false)} onDone={() => { setInitiate(false); load(); flash("success", "Designation submitted for approval."); }} flash={flash} />}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[140] px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 ${toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.type === "success" ? <CheckCircle2 size={16} /> : <X size={16} />} {toast.text}
        </div>
      )}
    </div>
  );
}

// ---- Detail: timeline + approve/reject + certificate ----------------------
function DetailModal({ id, onClose, onChanged, flash }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [signature, setSignature] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/designation-approvals/${id}`, { cache: "no-store" });
      if (r.ok) setD(await r.json());
    } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function approve() {
    if (!signature.trim()) { flash("error", "Please provide your signature/confirmation to approve."); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/designation-approvals/${id}/approve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: signature.trim(), remarks: remarks.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { flash("error", j.message || "Could not approve."); return; }
      flash("success", j.finalized ? "Final approval complete — designation is now FINAL." : "Approved.");
      setSignature(""); setRemarks(""); await load(); onChanged();
    } finally { setBusy(false); }
  }
  async function reject() {
    if (!reason.trim()) { flash("error", "A reason is required to reject."); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/designation-approvals/${id}/reject`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: reason.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { flash("error", j.message || "Could not reject."); return; }
      flash("success", "Rejected."); setRejecting(false); setReason(""); await load(); onChanged();
    } finally { setBusy(false); }
  }
  async function issueCert() {
    setBusy(true);
    try {
      const r = await fetch(`/api/designation-approvals/${id}/certificate`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { flash("error", j.message || "Certificate could not be generated."); return; }
      flash("success", "Certificate generated."); await load(); onChanged();
    } finally { setBusy(false); }
  }

  const a = d?.assignment;
  const tl = d?.timeline || [];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{a?.designation_name || "Designation"}</h3>
            <div className="text-sm text-gray-500 mt-0.5 flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1"><UserIcon size={13} /> {a?.member_name || "—"}</span>
              {a?.member_phone && <span className="inline-flex items-center gap-1"><Phone size={13} /> {a.member_phone}</span>}
              {a?.assembly_name && <span className="inline-flex items-center gap-1"><MapPin size={13} /> {a.assembly_name}</span>}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400"><X size={20} /></button>
        </div>

        <div className="overflow-y-auto px-6 py-4 space-y-4">
          {loading ? <div className="py-10 text-center text-gray-400"><Loader2 className="animate-spin inline" size={22} /></div> : !a ? null : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${overallStatus(a).cls}`}>{overallStatus(a).text}</span>
                {a.assigned_by_name && <span className="text-xs text-gray-400">Initiated by {a.assigned_by_name}</span>}
              </div>

              {/* Timeline stepper */}
              <div className="border border-gray-100 rounded-xl divide-y divide-gray-100">
                {tl.map((s) => (
                  <div key={s.level} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="w-6 text-center">{stepIcon(s.status)}</div>
                    <div className="w-6 text-xs text-gray-400 font-mono">L{s.level}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900">{s.role}</div>
                      {s.approver_name && <div className="text-[11px] text-gray-500">{s.approver_name}{s.signature ? ` · ✍ ${s.signature}` : ""}</div>}
                      {s.remarks && <div className="text-[11px] text-gray-400 truncate">“{s.remarks}”</div>}
                    </div>
                    <div className="text-[11px] text-right w-32 shrink-0">
                      {s.status === "approved" ? <span className="text-green-700 font-medium">Approved<br /><span className="text-gray-400">{fmtDate(s.approved_at)}</span></span>
                        : s.status === "pending" ? <span className="text-amber-600 font-medium">Pending</span>
                        : s.status === "rejected" ? <span className="text-red-600 font-medium">Rejected</span>
                        : <span className="text-gray-300">Locked</span>}
                    </div>
                  </div>
                ))}
              </div>

              {a.status === "rejected" && a.rejected_reason && (
                <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">Rejected: {a.rejected_reason}</div>
              )}

              {/* Approve control — only when THIS user may act on the current level */}
              {d?.can_approve_now && (
                <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 space-y-2">
                  <div className="text-sm font-semibold text-gray-900">You are the {d.current_level_label} — approve Level {a.current_level}</div>
                  <input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="Signature / confirmation (required)" className={`${inp} w-full`} />
                  <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Remarks (optional)" className={`${inp} w-full`} />
                  <div className="flex gap-2">
                    <button onClick={approve} disabled={busy} className="h-9 px-4 rounded-lg text-white text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60" style={{ background: BRAND }}>
                      {busy ? <Loader2 size={15} className="animate-spin" /> : <Stamp size={15} />} Approve
                    </button>
                    <button onClick={() => setRejecting((v) => !v)} disabled={busy} className="h-9 px-4 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50">Reject</button>
                  </div>
                  {rejecting && (
                    <div className="flex gap-2 pt-1">
                      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for rejection (required)" className={`${inp} flex-1`} />
                      <button onClick={reject} disabled={busy} className="h-9 px-4 rounded-lg bg-red-600 text-white text-sm font-semibold">Confirm Reject</button>
                    </div>
                  )}
                </div>
              )}

              {/* Certificate */}
              <div className="rounded-xl border border-gray-100 p-4 flex items-center gap-3">
                <Award size={22} className={a.status === "final_approved" ? "text-amber-500" : "text-gray-300"} />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-900">Certificate</div>
                  {a.certificate_status === "issued"
                    ? <div className="text-xs text-green-700">Issued · {a.certificate_number} · {fmtDate(a.certificate_issued_at)}</div>
                    : a.status === "final_approved"
                    ? <div className="text-xs text-gray-500">Available — all 7 approvals complete.</div>
                    : <div className="text-xs text-gray-400">Locked until all 7 approvals are complete.</div>}
                </div>
                {a.status === "final_approved" && (
                  <button onClick={issueCert} disabled={busy} className="h-9 px-4 rounded-lg text-white text-sm font-semibold disabled:opacity-60" style={{ background: BRAND }}>
                    {a.certificate_status === "issued" ? "Re-issue" : "Generate"}
                  </button>
                )}
              </div>
            </>
          )}
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
    fetch(`/api/contacts?search=${encodeURIComponent(debounced.trim())}&pageSize=10`, { cache: "no-store" })
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
      onDone();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Initiate Designation Approval</h3>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400"><X size={20} /></button>
        </div>
        <p className="text-xs text-gray-500">Submitting starts the 7-level approval chain. The member record is not changed until it is finally approved.</p>

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
