"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Filter, X } from "lucide-react";
import { wingShortLabel } from "@/lib/wingLabel";
import VacancyTable, { fromWingRow } from "./VacancyTable";

// Wing Designation Vacancies — President / Prabhari / General Secretary of each
// Wing at State → Lok Sabha → District → Assembly (GET /api/vacancies/wings).
const BRAND = "#164FA3";

function Card({ label, value, tone }) {
  const tones = { brand: "bg-[#164FA3] text-white border-[#164FA3]", green: "text-green-700", amber: "text-amber-700", red: "text-red-600", gray: "text-gray-600" };
  const box = tone === "brand" ? tones.brand : `bg-white border-gray-200 ${tones[tone] || ""}`;
  return (
    <div className={`rounded-xl border p-4 ${box}`} data-testid={`wing-card-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="text-2xl font-bold">{value ?? "—"}</div>
      <div className={`text-xs mt-1 ${tone === "brand" ? "text-white/90" : "text-gray-500"}`}>{label}</div>
    </div>
  );
}
export default function WingVacancies() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [wing, setWing] = useState("");
  const [level, setLevel] = useState("");
  const [role, setRole] = useState("");
  const [lokSabhaId, setLokSabhaId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [assemblyId, setAssemblyId] = useState("");
  const [status, setStatus] = useState("");

  const [updatedAt, setUpdatedAt] = useState(null);
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setErr("");
    try {
      const p = new URLSearchParams();
      if (wing) p.set("wing", wing);
      if (level) p.set("level", level);
      if (role) p.set("role", role);
      if (lokSabhaId) p.set("lok_sabha_id", lokSabhaId);
      if (districtId) p.set("district_id", districtId);
      if (assemblyId) p.set("assembly_id", assemblyId);
      if (status) p.set("status", status);
      const r = await fetch(`/api/vacancies/wings?${p.toString()}`, { cache: "no-store" });
      if (r.status === 403) { setData(null); setErr("You do not have access to this module."); return; }
      if (!r.ok) throw new Error("load failed");
      setData(await r.json());
      setUpdatedAt(new Date());
    } catch {
      // Drop any earlier result: stale rows next to a failed load would be misread.
      setData(null);
      setErr("Could not load the Wing vacancies. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [wing, level, role, lokSabhaId, districtId, assemblyId, status]);
  useEffect(() => { load(); }, [load]);
  // Vacancies are computed live from Contacts on every request. When the user comes
  // back to this tab (e.g. after editing a contact elsewhere) reload quietly, so the
  // page never shows stale status without a manual refresh.
  useEffect(() => {
    let last = Date.now();
    const revalidate = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 3000) return;
      last = Date.now();
      load({ quiet: true });
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => { window.removeEventListener("focus", revalidate); document.removeEventListener("visibilitychange", revalidate); };
  }, [load]);

  const locs = data?.filters?.locations || { lok_sabha: [], district: [], assembly: [] };
  const districts = useMemo(() => (lokSabhaId ? locs.district.filter((d) => String(d.parent_id) === lokSabhaId) : locs.district), [locs, lokSabhaId]);
  const assemblies = useMemo(() => {
    if (districtId) return locs.assembly.filter((a) => String(a.parent_id) === districtId);
    if (lokSabhaId) { const ds = new Set(districts.map((d) => d.id)); return locs.assembly.filter((a) => ds.has(a.parent_id)); }
    return locs.assembly;
  }, [locs, districtId, lokSabhaId, districts]);
  const c = data?.counts || {};
  const sel = "h-10 rounded-lg border border-gray-200 text-sm px-2 text-gray-700 bg-white";
  const clear = () => { setWing(""); setLevel(""); setRole(""); setLokSabhaId(""); setDistrictId(""); setAssemblyId(""); setStatus(""); };

  return (
    <div data-testid="wing-vacancies">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm text-gray-500">President, Prabhari and General Secretary of every Wing at State → Lok Sabha → District → Assembly, checked against saved Contacts.</p>
        <div className="flex items-center gap-3 shrink-0">
          {updatedAt && <span className="text-[11px] text-gray-400" data-testid="wing-updated-at">Updated {updatedAt.toLocaleTimeString("en-GB")}</span>}
          <button onClick={() => load()} className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <Card label="Total Positions" value={c.total} tone="brand" />
        <Card label="Filled" value={c.filled} tone="green" />
        <Card label="Vacant" value={c.vacant} tone="amber" />
        <Card label="Needs Review" value={c.review} tone="red" />
        <Card label="Not Configured" value={c.not_configured} tone="gray" />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
        <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-gray-700"><Filter size={15} /> Filters
          <button onClick={clear} className="ml-auto inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"><X size={13} /> Clear</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <select className={sel} value={wing} onChange={(e) => setWing(e.target.value)} aria-label="Wing">
            <option value="">All Wings</option>
            {(data?.filters?.wings || []).map((w) => <option key={w} value={w}>{wingShortLabel(w)} Wing</option>)}
          </select>
          <select className={sel} value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Level">
            <option value="">All levels</option>
            {(data?.filters?.levels || []).map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
          <select className={sel} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Designation">
            <option value="">All designations</option>
            {(data?.filters?.roles || []).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <select className={sel} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Vacant &amp; needs review</option>
            <option value="vacant">Vacant only</option>
            <option value="review">Needs review only</option>
            <option value="filled">Filled only</option>
          </select>
          <select className={sel} value={lokSabhaId} onChange={(e) => { setLokSabhaId(e.target.value); setDistrictId(""); setAssemblyId(""); }} aria-label="Lok Sabha">
            <option value="">All Lok Sabha</option>
            {locs.lok_sabha.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select className={sel} value={districtId} onChange={(e) => { setDistrictId(e.target.value); setAssemblyId(""); }} aria-label="District">
            <option value="">All Districts</option>
            {districts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select className={sel} value={assemblyId} onChange={(e) => setAssemblyId(e.target.value)} aria-label="Assembly">
            <option value="">All Assemblies</option>
            {assemblies.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </div>

      {err && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{err}</div>}

      {/* Per-Wing summary */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-gray-100"><h2 className="text-sm font-bold text-gray-900">Wing-wise Summary</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]" data-testid="wing-summary">
            <thead><tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wide">
              <th className="px-4 py-2.5 font-semibold">Wing</th><th className="px-4 py-2.5 font-semibold text-right">Total</th>
              <th className="px-4 py-2.5 font-semibold text-right">Filled</th><th className="px-4 py-2.5 font-semibold text-right">Vacant</th>
              <th className="px-4 py-2.5 font-semibold text-right">Review</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400"><Loader2 className="animate-spin inline" size={18} /></td></tr>
              ) : !data?.by_wing?.length ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">{err ? "Data unavailable." : "No Wing positions configured for this scope."}</td></tr>
              ) : data.by_wing.map((w) => (
                <tr key={w.wing} className="hover:bg-gray-50 cursor-pointer" onClick={() => setWing(w.wing)}>
                  <td className="px-4 py-2 font-medium text-gray-900">{w.wing}</td>
                  <td className="px-4 py-2 text-right font-semibold">{w.total}</td>
                  <td className="px-4 py-2 text-right text-green-700">{w.filled}</td>
                  <td className="px-4 py-2 text-right text-amber-700">{w.vacant}</td>
                  <td className="px-4 py-2 text-right text-red-600">{w.review}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Vacancy list */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <h2 className="text-sm font-bold text-gray-900">Wing Vacancy List</h2>
          {data?.capped && <span className="ml-auto text-xs text-amber-600">Showing the first {data.vacancies.length} rows — narrow the filters to see more.</span>}
        </div>
        <VacancyTable
          rows={(data?.vacancies || []).map(fromWingRow)}
          loading={loading}
          err={err}
          errorText="Wing vacancies could not be calculated — no positions are shown."
        />
      </div>
    </div>
  );
}
