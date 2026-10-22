"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, UserCog, Loader2, Shield, Filter, X, Send, RefreshCw, MapPin, ChevronDown, CheckCircle2,
} from "lucide-react";
import { normalizeRole, ROLES } from "@/lib/permissions";
import { usePageAccess } from "@/components/usePageAccess";
import WingVacancies from "./WingVacancies";
import VacancyTable, { fromMainRow, CategorySwitch } from "./VacancyTable";

const BRAND = "#164FA3";
// Default filters: Main Organisation (designations of no other Wing) at State level.
// Must match MAIN_WING_FILTER in lib/vacancyDashboard.
const MAIN_WING = "__main__";
const DEFAULT_LEVEL = "state";

function fmtDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

function reminderChip(status) {
  const s = String(status || "").toLowerCase();
  if (s === "sent") return "bg-green-50 text-green-700 border-green-200";
  if (s === "failed") return "bg-red-50 text-red-700 border-red-200";
  if (s === "none") return "bg-gray-50 text-gray-400 border-gray-200";
  return "bg-amber-50 text-amber-700 border-amber-200"; // pending
}

function StatCard({ label, value, tone }) {
  const toneCls = {
    brand: "bg-[#164FA3] text-white",
    green: "bg-white border border-green-200",
    amber: "bg-white border border-amber-200",
    red: "bg-white border border-red-200",
  }[tone] || "bg-white border border-gray-200";
  const valCls = tone === "brand" ? "text-white" : tone === "green" ? "text-green-700" : tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-700" : "text-gray-900";
  const labelCls = tone === "brand" ? "text-blue-100" : "text-gray-500";
  return (
    <div className={`${toneCls} rounded-xl p-4 shadow-sm`}>
      <div className={`text-2xl font-bold ${valCls}`}>{value == null ? "—" : Number(value).toLocaleString("en-IN")}</div>
      <div className={`text-xs font-medium mt-1 ${labelCls}`}>{label}</div>
    </div>
  );
}

export default function VacanciesPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const isSuper = normalizeRole(session?.user?.role) === ROLES.SUPER_ADMIN;
  const { has, loading: pagesLoading } = usePageAccess();
  const canAccess = isSuper || has("vacancies");

  // "main" = Main Organisation designations (below); "wings" = Wing vacancies.
  // Kept in the URL (?tab=wings) so a refresh / shared link reopens the same view.
  const [tab, setTab] = useState("main");
  useEffect(() => {
    try { if (new URLSearchParams(window.location.search).get("tab") === "wings") setTab("wings"); } catch {}
  }, []);
  const switchTab = (t) => {
    setTab(t);
    try {
      const u = new URL(window.location.href);
      if (t === "wings") u.searchParams.set("tab", "wings"); else u.searchParams.delete("tab");
      window.history.replaceState(null, "", u.toString());
    } catch {}
  };

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);

  // Filters
  // Default view: Main Organisation at State level (the page opens on it, and
  // returns to it on refresh / Clear) — no need to pick them by hand.
  const [wing, setWing] = useState(MAIN_WING);
  const [level, setLevel] = useState(DEFAULT_LEVEL);
  const [lokSabhaId, setLokSabhaId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [assemblyId, setAssemblyId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [statusF, setStatusF] = useState(""); // '', vacant, review (Vacant Designation) | filled (Filed Designation)
  // Two categories: Vacant Designation (vacant + needs review, with the existing
  // reminder actions) and Filed Designation (assigned, display-only).
  const filedView = statusF === "filled";
  const showCategory = (k) => {
    if (k === "filed") { setStatusF("filled"); setReminderF(""); setResponsibleF(""); }
    else setStatusF("");
  };
  const [reminderF, setReminderF] = useState("");
  const [responsibleF, setResponsibleF] = useState("");

  const flash = (type, text) => { setToast({ type, text }); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(async (opts) => {
    if (!canAccess) return;
    if (!opts?.quiet) setLoading(true);
    setErr("");
    try {
      const p = new URLSearchParams();
      p.set("wing", wing);
      if (level) p.set("level", level);
      if (lokSabhaId) p.set("lok_sabha_id", lokSabhaId);
      if (districtId) p.set("district_id", districtId);
      if (assemblyId) p.set("assembly_id", assemblyId);
      if (blockId) p.set("block_id", blockId);
      if (designationId) p.set("designation_id", designationId);
      if (statusF) p.set("status", statusF);
      if (reminderF) p.set("reminder_status", reminderF);
      if (responsibleF) p.set("responsible_id", responsibleF);
      const r = await fetch(`/api/vacancies?${p.toString()}`, { cache: "no-store" });
      if (r.status === 403) { setErr("You do not have access to this module."); setData(null); return; }
      if (!r.ok) throw new Error("load failed");
      const d = await r.json();
      setData(d);
      // The server ignores a Designation that isn't valid for the chosen Wing /
      // Level / area; drop it here too so the selection never shows a stale value.
      if (d.designation_cleared) setDesignationId("");
    } catch {
      // Drop any earlier result: stale rows next to a failed load would be misread.
      setData(null);
      setErr("Could not load the vacancy dashboard. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [canAccess, wing, level, lokSabhaId, districtId, assemblyId, blockId, designationId, statusF, reminderF, responsibleF]);

  useEffect(() => { if (tab === "main") load(); }, [load, tab]);
  // Computed live from Contacts — reload quietly when the user returns to this tab
  // (e.g. after editing a contact), so the list never stays stale.
  useEffect(() => {
    if (tab !== "main") return undefined;
    let last = Date.now();
    const revalidate = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 3000) return;
      last = Date.now();
      load({ quiet: true });
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => { window.removeEventListener("focus", revalidate); document.removeEventListener("visibilitychange", revalidate); };
  }, [load, tab]);

  // Cascading location option lists (filtered by the chosen parent).
  const locs = data?.filters?.locations || { lok_sabha: [], district: [], assembly: [], block: [] };
  const districts = useMemo(() => locs.district.filter((d) => !lokSabhaId || String(d.parent_id) === String(lokSabhaId)), [locs.district, lokSabhaId]);
  const assemblies = useMemo(() => locs.assembly.filter((a) => !districtId || String(a.parent_id) === String(districtId)), [locs.assembly, districtId]);
  const blocks = useMemo(() => locs.block.filter((b) => !assemblyId || String(b.parent_id) === String(assemblyId)), [locs.block, assemblyId]);

  // One reminder per responsible person (covers all their open vacancies).
  async function sendReminder(rp) {
    if (!rp?.contact_id) return;
    setBusyId(rp.contact_id);
    try {
      const r = await fetch("/api/vacancies/remind", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: rp.contact_id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { flash("error", d.message || "Could not send the reminder."); return; }
      if (d.status === "sent" && d.wa_url) {
        window.open(d.wa_url, "_blank", "noopener,noreferrer");
        flash("success", `WhatsApp opened for ${rp.name} (${d.count} vacanc${d.count === 1 ? "y" : "ies"}).`);
      } else if (d.status === "failed") {
        flash("error", d.message || "Reminder failed — no valid WhatsApp number.");
      }
      load();
    } catch {
      flash("error", "Could not send the reminder.");
    } finally {
      setBusyId(null);
    }
  }

  const anyFilter = wing !== MAIN_WING || level !== DEFAULT_LEVEL || lokSabhaId || districtId || assemblyId || blockId || designationId || statusF || reminderF || responsibleF;
  // Back to the default view (Main Organisation + State), not to "everything".
  const clearFilters = () => {
    setWing(MAIN_WING); setLevel(DEFAULT_LEVEL); setLokSabhaId(""); setDistrictId(""); setAssemblyId(""); setBlockId("");
    setDesignationId(""); setStatusF(""); setReminderF(""); setResponsibleF("");
  };

  if (authStatus === "loading" || (!isSuper && pagesLoading)) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="animate-spin" style={{ color: BRAND }} size={28} /></div>;
  }
  if (!canAccess) {
    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center">
        <div className="max-w-md w-full bg-white border border-gray-200 rounded-2xl shadow-sm p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4"><Shield size={26} /></div>
          <h2 className="text-lg font-bold text-gray-900">Access Denied</h2>
          <p className="text-sm text-gray-500 mt-2">You do not have access to the Designation Vacancies module.</p>
          <button onClick={() => router.push("/dashboard")} className="mt-6 h-10 px-5 rounded-lg text-white text-sm font-semibold" style={{ background: BRAND }}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  const c = data?.counts || {};
  const selCls = "h-10 rounded-lg border border-gray-200 text-sm px-2 text-gray-700 bg-white";

  return (
    <div className="max-w-[1500px] mx-auto">
      {/* Back to the dashboard — Designation Vacancies is a standalone page
          (its own sidebar entry), no longer part of Contacts. */}
      <Link href="/dashboard" data-testid="back-to-designation"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#164FA3] mb-3">
        <ArrowLeft size={16} /> Back to Dashboard
      </Link>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white" style={{ background: BRAND }}><UserCog size={22} /></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Designation Vacancies &amp; Reminders</h1>
            <p className="text-sm text-gray-500">Live vacant posts across State → Lok Sabha → District → Assembly → Block, with WhatsApp reminders to the responsible person.</p>
          </div>
        </div>
        {tab === "main" && (
          <button onClick={() => load()} className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            <RefreshCw size={16} /> Refresh
          </button>
        )}
      </div>

      {/* View: Main Organisation designations | Wing designations */}
      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 mb-4" role="tablist">
        {[["main", "Main Organisation"], ["wings", "Wings"]].map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} data-testid={`tab-${k}`} onClick={() => switchTab(k)}
            className={`h-8 px-4 rounded-md text-sm font-semibold ${tab === k ? "text-white" : "text-gray-600 hover:bg-gray-50"}`}
            style={tab === k ? { background: BRAND } : undefined}>{label}</button>
        ))}
      </div>

      {tab === "wings" ? <WingVacancies /> : (<>
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-7 gap-3 mb-4">
        <StatCard label="Total Positions" value={c.total} tone="brand" />
        <StatCard label="Filed" value={c.filled} tone="green" />
        <StatCard label="Vacant" value={c.vacant} tone="amber" />
        {/* Not vacant: a holder of the designation exists but their location is
            missing/invalid, so the position can't be confirmed either way. */}
        <StatCard label="Needs Review" value={c.review} tone="red" />
        <StatCard label="Reminders Sent" value={c.reminders_sent} tone="green" />
        <StatCard label="Reminders Pending" value={c.reminders_pending} tone="amber" />
        <StatCard label="Reminders Failed" value={c.reminders_failed} tone="red" />
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
        <div className="flex items-center gap-2 mb-3 text-gray-600"><Filter size={15} /><span className="text-sm font-semibold">Filters</span></div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* Wing → Level → Designation: the Designation options always follow the
              chosen Wing, Level and area (from the server), and a parent change
              clears a Designation that no longer applies. */}
          <select className={selCls} aria-label="Wing" value={wing} onChange={(e) => { setWing(e.target.value); setDesignationId(""); }}>
            {(data?.filters?.wings || [{ key: MAIN_WING, label: "Main Organisation" }]).map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
          </select>
          <select className={selCls} aria-label="Level" value={level} onChange={(e) => { setLevel(e.target.value); setDesignationId(""); }}>
            <option value="">All levels</option>
            {(data?.filters?.levels || []).map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
          <select className={selCls} value={lokSabhaId} onChange={(e) => { setLokSabhaId(e.target.value); setDistrictId(""); setAssemblyId(""); setBlockId(""); }}>
            <option value="">All Lok Sabha</option>
            {locs.lok_sabha.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select className={selCls} value={districtId} onChange={(e) => { setDistrictId(e.target.value); setAssemblyId(""); setBlockId(""); }}>
            <option value="">All Districts</option>
            {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className={selCls} value={assemblyId} onChange={(e) => { setAssemblyId(e.target.value); setBlockId(""); }}>
            <option value="">All Assemblies</option>
            {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className={selCls} value={blockId} onChange={(e) => setBlockId(e.target.value)}>
            <option value="">All Blocks</option>
            {blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className={selCls} aria-label="Designation" value={designationId} onChange={(e) => setDesignationId(e.target.value)}>
            <option value="">All Designations{data?.filters?.designations ? ` (${data.filters.designations.length})` : ""}</option>
            {(data?.filters?.designations || []).map((d) => <option key={d.level + d.id} value={d.id}>{d.name}{level ? "" : ` · ${d.level_label}`}</option>)}
          </select>
          {/* Vacant-only filters (status detail, reminders, responsible person). */}
          {!filedView && (<>
          <select className={selCls} value={statusF} onChange={(e) => setStatusF(e.target.value)} aria-label="Vacant status">
            <option value="">Vacant &amp; needs review</option>
            <option value="vacant">Vacant only</option>
            <option value="review">Needs review only</option>
          </select>
          <select className={selCls} value={reminderF} onChange={(e) => setReminderF(e.target.value)}>
            <option value="">All reminder status</option>
            <option value="pending">Pending</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
          <select className={selCls} value={responsibleF} onChange={(e) => setResponsibleF(e.target.value)}>
            <option value="">All responsible persons</option>
            {(data?.filters?.responsibles || []).map((r) => <option key={r.contact_id} value={r.contact_id}>{r.name}</option>)}
          </select>
          </>)}
          {anyFilter && (
            <button onClick={clearFilters} className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 self-center">
              <X size={13} /> Clear filters
            </button>
          )}
        </div>
      </div>

      {err && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{err}</div>}


      {/* Hierarchy drill-down */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <MapPin size={16} style={{ color: BRAND }} />
          <h2 className="text-sm font-bold text-gray-900">Hierarchy-wise Vacancy Summary</h2>
          <span className="ml-auto text-xs text-gray-400">Total · Filed · Vacant · Review · Vacant %</span>
        </div>
        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-gray-50 text-left text-gray-500 text-[11px] uppercase tracking-wide sticky top-0">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Level</th>
                <th className="px-4 py-2.5 font-semibold">Location</th>
                <th className="px-4 py-2.5 font-semibold">Under</th>
                <th className="px-4 py-2.5 font-semibold text-right">Total</th>
                <th className="px-4 py-2.5 font-semibold text-right">Filed</th>
                <th className="px-4 py-2.5 font-semibold text-right">Vacant</th>
                <th className="px-4 py-2.5 font-semibold text-right">Review</th>
                <th className="px-4 py-2.5 font-semibold text-right">Vacant %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400"><Loader2 className="animate-spin inline" size={18} /></td></tr>
              ) : !data?.hierarchy?.length ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">{err ? "Data unavailable." : "No organizational data for this scope."}</td></tr>
              ) : data.hierarchy.map((h) => (
                <tr key={h.level + ":" + h.location_id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5"><span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">{h.level_label}</span></td>
                  <td className="px-4 py-2.5 font-medium text-gray-900">{h.location_name || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{[h.block_name && h.level !== "block" ? null : null, h.assembly_name, h.district_name, h.lok_sabha_name].filter(Boolean).slice(0, 2).join(" · ") || "—"}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{h.total}</td>
                  <td className="px-4 py-2.5 text-right text-green-700">{h.filled}</td>
                  <td className="px-4 py-2.5 text-right text-amber-700">{h.vacant}</td>
                  <td className="px-4 py-2.5 text-right text-red-600">{h.review || 0}</td>
                  <td className="px-4 py-2.5 text-right"><span className={h.incomplete_pct >= 50 ? "text-red-600 font-semibold" : "text-gray-600"}>{h.incomplete_pct}%</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Vacancy list */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
          <CategorySwitch filed={filedView} vacantCount={(c.vacant || 0) + (c.review || 0)} filedCount={c.filled || 0} onChange={showCategory} />
          {filedView && <span className="text-xs text-gray-500">Assigned designations — display only on this page.</span>}
          {data?.wing_positions_skipped > 0 && (
            <button onClick={() => switchTab("wings")} className="text-xs text-violet-700 hover:underline" data-testid="wing-positions-note">
              Wing President / Prabhari / General Secretary posts are listed in the Wings tab →
            </button>
          )}
          {data?.capped && <span className="ml-auto text-xs text-amber-600">Showing the first {data.vacancies.length} rows — narrow the filters to see more.</span>}
        </div>
        <VacancyTable
          rows={(data?.vacancies || []).map(fromMainRow)}
          mode={filedView ? "filed" : "vacant"}
          emptyText={filedView ? "No filed designations for these filters." : "No vacant designations for these filters."}
          loading={loading}
          err={err}
          renderContactExtra={(l) => l.reminder ? (
            <>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border capitalize ${reminderChip(l.reminder.reminder_status)}`}>{l.reminder.reminder_status}{l.reminder.reminder_attempts ? ` · ${l.reminder.reminder_attempts}` : ""}</span>
              {l.reminder.last_reminder_at && <span className="text-[11px] text-gray-400">{fmtDateTime(l.reminder.last_reminder_at)}</span>}
              <button onClick={() => sendReminder(l.reminder)} disabled={busyId === l.contact_id}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-white text-xs font-semibold disabled:opacity-60" style={{ background: "#22a45d" }}>
                {busyId === l.contact_id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} WhatsApp
              </button>
            </>
          ) : null}
        />
      </div>

      </>)}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[140] px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 ${toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.type === "success" ? <CheckCircle2 size={16} /> : <X size={16} />} {toast.text}
        </div>
      )}
    </div>
  );
}
