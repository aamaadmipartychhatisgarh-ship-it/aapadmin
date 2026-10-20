"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Filter, X, CheckCircle2, ShieldAlert } from "lucide-react";
import { wingShortLabel } from "@/lib/wingLabel";

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

function StatusChip({ status }) {
  if (status === "filled") return <span className="text-xs font-medium px-2 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-200">Filled</span>;
  if (status === "review") return <span className="text-xs font-medium px-2 py-0.5 rounded-full border bg-red-50 text-red-700 border-red-200">Needs review</span>;
  return <span className="text-xs font-bold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">VACANT</span>;
}

// Wing mapping problems — kept apart so they are never shown as vacancies.
function WingDataCheck({ dq }) {
  const nc = dq?.not_configured || [];
  const mm = dq?.wing_mismatch || [];
  const unk = dq?.unknown_wing_designations || [];
  const um = dq?.unmapped_holders || [];
  const orph = dq?.orphan_assignments || [];
  const hc = dq?.hierarchy_conflicts || [];
  if (!nc.length && !mm.length && !unk.length && !um.length && !orph.length && !hc.length) return null;
  // Not-configured roles grouped by Wing → "Prabhari: State, District".
  const grouped = new Map();
  for (const n of nc) {
    if (!grouped.has(n.wing)) grouped.set(n.wing, new Map());
    const g = grouped.get(n.wing);
    if (!g.has(n.role_label)) g.set(n.role_label, []);
    g.get(n.role_label).push(n.level_label);
  }
  return (
    <div className="bg-white border border-red-200 rounded-xl mb-4" data-testid="wing-data-check">
      <div className="px-4 py-3 border-b border-red-100 flex items-center gap-2 bg-red-50/60 rounded-t-xl">
        <ShieldAlert size={16} className="text-red-600" />
        <h2 className="text-sm font-bold text-red-700">Wing data check — these are NOT counted as vacancies</h2>
      </div>
      <div className="px-4 py-3 space-y-3 text-xs text-gray-700">
        {mm.length > 0 && (
          <div>
            <div className="font-semibold text-gray-600 mb-1">{mm.length} holder{mm.length === 1 ? "" : "s"} whose saved Wing does not match the designation&apos;s Wing — related positions show as &ldquo;Needs review&rdquo;</div>
            {mm.map((m) => <div key={`${m.contact_id}:${m.designation_id}`}><span className="font-medium text-gray-900">{m.person_name}</span> · {m.designation_name} ({m.level_label}, {m.location_name}) — saved Wings: {m.saved_wings.join(", ") || "—"}</div>)}
          </div>
        )}
        {hc.length > 0 && (
          <div>
            <div className="font-semibold text-gray-600 mb-1">{hc.length} holder{hc.length === 1 ? "" : "s"} whose saved Lok Sabha / District / Assembly disagree — related positions show as &ldquo;Needs review&rdquo;</div>
            {hc.map((m) => <div key={`${m.contact_id}:${m.designation_id}`}><span className="font-medium text-gray-900">{m.person_name}</span> · {m.designation_name} — {m.reason}</div>)}
          </div>
        )}
        {um.length > 0 && (
          <div>
            <div className="font-semibold text-gray-600 mb-1">{um.length} Wing designation holder{um.length === 1 ? "" : "s"} with a missing or invalid location</div>
            {um.map((u) => <div key={`${u.contact_id}:${u.designation_id}`}><span className="font-medium text-gray-900">{u.person_name}</span> · {u.designation_name} ({u.level_label}) — {u.reason}</div>)}
          </div>
        )}
        {orph.length > 0 && (
          <div>
            <div className="font-semibold text-gray-600 mb-1">{orph.length} contact assignment{orph.length === 1 ? "" : "s"} point to a designation that no longer exists — they fill no position</div>
            {orph.map((o) => <div key={`${o.contact_id}:${o.designation_id}`}><span className="font-medium text-gray-900">{o.person_name}</span> · designation id {o.designation_id}</div>)}
          </div>
        )}
        {unk.length > 0 && (
          <div>
            <div className="font-semibold text-gray-600 mb-1">{unk.length} designation{unk.length === 1 ? "" : "s"} tagged with a Wing that is not in the Wing master</div>
            {unk.map((u) => <div key={`${u.designation_id}:${u.wing}`}>{u.designation_name} ({u.level_label}) — Wing &ldquo;{u.wing}&rdquo;</div>)}
          </div>
        )}
        {grouped.size > 0 && (
          <div>
            <div className="font-semibold text-gray-600 mb-1">Roles not configured in the Wing master (no designation exists, so no position can be checked)</div>
            {[...grouped.entries()].map(([wing, roles]) => (
              <div key={wing}><span className="font-medium text-gray-900">{wing}</span>: {[...roles.entries()].map(([role, lv]) => `${role} (${lv.join(", ")})`).join(" · ")}</div>
            ))}
          </div>
        )}
      </div>
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

      <WingDataCheck dq={data?.data_quality} />

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
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1180px]">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wide">
                <th className="px-3 py-3 font-semibold">Wing</th>
                <th className="px-3 py-3 font-semibold">Level</th>
                <th className="px-3 py-3 font-semibold">Location</th>
                <th className="px-3 py-3 font-semibold">Vacant Designation</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Responsible Person</th>
                <th className="px-3 py-3 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-gray-400"><Loader2 className="animate-spin inline" size={22} /></td></tr>
              ) : err ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-gray-400">Wing vacancies could not be calculated — no positions are shown.</td></tr>
              ) : !data?.vacancies?.length ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-gray-400"><CheckCircle2 size={28} className="mx-auto mb-2 opacity-40" />No positions for these filters.</td></tr>
              ) : data.vacancies.map((r) => (
                <tr key={`${r.wing}|${r.level}|${r.location_id}|${r.role}`} className="hover:bg-gray-50 align-top" data-status={r.status} data-wing={r.wing}>
                  <td className="px-3 py-2.5"><span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-200">{wingShortLabel(r.wing)}</span></td>
                  <td className="px-3 py-2.5"><span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">{r.level_label}</span></td>
                  <td className="px-3 py-2.5 text-gray-700">
                    <span className="font-medium text-gray-900">{r.location_name || "—"}</span>
                    {[r.assembly_name, r.district_name, r.lok_sabha_name].filter((x) => x && x !== r.location_name).length > 0 && (
                      <span className="block text-[11px] text-gray-400">{[r.assembly_name, r.district_name, r.lok_sabha_name].filter((x) => x && x !== r.location_name).join(" · ")}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-semibold text-gray-900">{r.role_label}</span>
                    <span className="block text-[11px] text-gray-400">{r.designation_name}</span>
                  </td>
                  <td className="px-3 py-2.5"><StatusChip status={r.status} /></td>
                  {/* Same Wing, same role, one level up — never the vacant post itself. */}
                  <td className="px-3 py-2.5 text-xs" data-testid="wing-responsible">
                    {r.status !== "vacant" || !r.responsible ? (
                      <span className="text-gray-400">—</span>
                    ) : r.responsible.status === "assigned" ? (
                      r.responsible.people.map((h) => (
                        <div key={h.contact_id}>
                          <span className="text-gray-500">{h.designation}{r.responsible.area && r.responsible.area !== "State" ? ` (${r.responsible.area})` : ""}</span>
                          <span className="text-gray-400"> – </span>
                          <span className="font-semibold text-gray-900">{h.name}</span>
                        </div>
                      ))
                    ) : r.responsible.status === "top_level" ? (
                      <span className="text-gray-500">{r.responsible.note}</span>
                    ) : (
                      <span className="font-semibold text-red-600" data-testid="wing-responsible-missing">{r.responsible.note}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">
                    {r.status === "filled" ? (
                      r.holders.map((h) => (
                        <div key={h.contact_id} data-testid="wing-holder">
                          Held by <span className="font-medium text-gray-900">{h.name}</span>
                          {/* The holder's saved Contact fields the match was made on. */}
                          <span className="block text-[11px] text-gray-400">
                            {[h.wings?.length ? `Wing: ${h.wings.join(", ")}` : "Wing: (from designation)", h.designation, h.lok_sabha_name && `LS: ${h.lok_sabha_name}`, h.district_name && `District: ${h.district_name}`, h.assembly_name && `Assembly: ${h.assembly_name}`].filter(Boolean).join(" · ")}
                          </span>
                        </div>
                      ))
                    ) : r.status === "review" ? (
                      r.review_people.map((p) => <div key={p.contact_id}><span className="font-medium text-gray-900">{p.person_name}</span> — {p.reason}</div>)
                    ) : (
                      <>
                        <div className="font-medium text-gray-700" data-testid="wing-path">{r.path}</div>
                        <span className="text-gray-400">No eligible saved contact holds this post</span>
                      </>
                    )}
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
