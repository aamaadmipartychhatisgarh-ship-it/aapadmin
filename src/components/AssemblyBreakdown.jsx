"use client";

import { useEffect, useMemo, useState } from "react";
import { Layers, Star, Loader2, FileText, Search, X } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LabelList } from "recharts";

// Dashboard bottom section — two assembly-wise charts side by side:
//   • Worker by Assembly     (live Contacts-based worker count, moved here from Analytics)
//   • Influencer by Assembly (live Influencer count)
// Both read /api/dashboard/assembly-breakdown, which lists EVERY master assembly
// (zero included) using the same Assembly master, so the two stay consistent with
// each other and with the rest of the app. Same chart design as the old Analytics
// "Workers by Assembly" (horizontal bars, scroll container, right labels, total).

function ChartTooltip({ active, payload, unitLabel, color }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-md px-3 py-2 text-xs">
      <div className="font-bold text-gray-900">{d.assembly}</div>
      <div className="text-gray-600 mt-0.5">{unitLabel}: <strong style={{ color }}>{Number(d.value).toLocaleString("en-IN")}</strong></div>
    </div>
  );
}

// Filters of a card (Assembly + search) → query string shared by the filtered chart counts and the PDF export, so both always hold
// the same records. The API (/api/dashboard/assembly-breakdown/people) applies the same rules as the unfiltered chart.
function filterQs(kind, assembly, search, extra = {}) {
  const p = new URLSearchParams({ kind });
  if (assembly) p.set("assembly", assembly);
  if (search) p.set("q", search);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

function AssemblyBarChart({ title, icon: Icon, rows, dataKey, unitLabel, color, note, totalOverride, kind }) {
  const [assembly, setAssembly] = useState("");          // "" = all, an id, or "none" (not mapped)
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filtered, setFiltered] = useState(null);        // { rows, total, unmapped, show_unmapped } for the active filters
  const [fLoading, setFLoading] = useState(false);
  const [fErr, setFErr] = useState("");
  const [exporting, setExporting] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 350); return () => clearTimeout(t); }, [search]);
  const filtering = !!(assembly || debounced);
  useEffect(() => {
    if (!filtering) { setFiltered(null); setFErr(""); return undefined; }
    let alive = true;
    setFLoading(true); setFErr("");
    fetch(`/api/dashboard/assembly-breakdown/people?${filterQs(kind, assembly, debounced)}`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.message || "Could not apply the filter."); return d; })
      .then((d) => { if (alive) setFiltered(d); })
      .catch((e) => { if (alive) { setFiltered(null); setFErr(e.message); } })
      .finally(() => { if (alive) setFLoading(false); });
    return () => { alive = false; };
  }, [kind, assembly, debounced, filtering]);
  const options = useMemo(() => [...rows].sort((a, b) => String(a.assembly).localeCompare(String(b.assembly))), [rows]);
  const data = useMemo(() => (filtering && filtered
    ? filtered.rows.map((r) => ({ assembly: r.assembly, value: Number(r.value) || 0 })).concat(filtered.show_unmapped && filtered.unmapped ? [{ assembly: "Not mapped to an Assembly", value: filtered.unmapped }] : [])
    : rows.map((r) => ({ assembly: r.assembly, value: Number(r[dataKey]) || 0 }))), [rows, dataKey, filtering, filtered]);
  const total = useMemo(() => (filtering && filtered ? filtered.total : totalOverride != null ? totalOverride : data.reduce((s, r) => s + r.value, 0)), [data, totalOverride, filtering, filtered]);

  // Every record matching the card's filters (all Assemblies / pages — the server reads them all), as a PDF.
  async function exportPdf() {
    if (exporting) return;
    setExporting(true); setFErr("");
    try {
      const r = await fetch(`/api/dashboard/assembly-breakdown/people?${filterQs(kind, assembly, search.trim(), { format: "pdf" })}`, { cache: "no-store" });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || "Export failed."); }
      const blob = await r.blob();
      const name = (r.headers.get("content-disposition") || "").match(/filename="?([^"]+)"?/i)?.[1] || `${kind}-by-assembly.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      setFErr(e.message || "Export failed — network error.");
    } finally { setExporting(false); }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}14`, color }}><Icon size={16} /></span>
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
        <button type="button" onClick={exportPdf} disabled={exporting} data-testid={`${kind}-assembly-pdf`}
          title={`Export ${unitLabel.toLowerCase()} for the selected Assembly / search as PDF`}
          className="no-print ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-[#164FA3] text-[#164FA3] hover:bg-blue-50 disabled:opacity-50">
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} {exporting ? "Preparing…" : "Export PDF"}
        </button>
      </div>
      <div className="no-print flex flex-wrap items-center gap-2 mb-2">
        <select value={assembly} onChange={(e) => setAssembly(e.target.value)} data-testid={`${kind}-assembly-filter`} aria-label="Assembly"
          className={`h-8 px-2 rounded-lg border text-xs bg-white max-w-full ${assembly ? "border-[#164FA3] text-[#164FA3] font-semibold" : "border-gray-200 text-gray-700"}`}>
          <option value="">All Assemblies</option>
          {options.map((a) => <option key={a.id} value={a.id}>{a.assembly}</option>)}
          <option value="none">Not mapped to an Assembly</option>
        </select>
        <div className="relative flex-1 min-w-[160px]">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} data-testid={`${kind}-assembly-search`}
            placeholder="Search Assembly, name or mobile" aria-label="Search"
            className="w-full h-8 pl-7 pr-7 rounded-lg border border-gray-200 text-xs bg-white" />
          {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"><X size={13} /></button>}
        </div>
        {fLoading && <Loader2 size={14} className="animate-spin text-gray-400" />}
      </div>
      {fErr && <p className="text-xs text-red-600 mb-2">{fErr}</p>}
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <p className="text-xs text-gray-400">{filtering ? `Filtered: ${filtered ? filtered.rows.length : "…"} assembl${filtered?.rows.length === 1 ? "y" : "ies"} matching the selection.` : `Live count per assembly, highest to lowest. All ${data.length} assemblies.`}</p>
        <p className="text-xs font-semibold text-gray-700" data-testid={`${kind}-assembly-total`}>Total: <span style={{ color }}>{Number(total).toLocaleString("en-IN")}</span></p>
      </div>
      {filtering ? null : note}
      {data.length === 0 ? (
        <div className="h-[120px] flex items-center justify-center text-gray-400 text-sm">No assembly data available.</div>
      ) : (
        <div className="overflow-y-auto" style={{ maxHeight: 520 }}>
          <ResponsiveContainer width="100%" height={Math.max(220, data.length * 24)}>
            <BarChart layout="vertical" data={data} margin={{ top: 4, right: 48, bottom: 4, left: 8 }} barCategoryGap={4}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#9ca3af" }} />
              <YAxis type="category" dataKey="assembly" width={150} interval={0} tick={{ fontSize: 11, fill: "#374151" }} />
              <Tooltip cursor={{ fill: "rgba(22,79,163,0.06)" }} content={<ChartTooltip unitLabel={unitLabel} color={color} />} />
              <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
                <LabelList dataKey="value" position="right" formatter={(v) => Number(v).toLocaleString("en-IN")} style={{ fontSize: 11, fill: "#374151", fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default function AssemblyBreakdown() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setErr("");
      try {
        const r = await fetch("/api/dashboard/assembly-breakdown", { cache: "no-store" });
        if (!r.ok) throw new Error("load failed");
        const d = await r.json();
        if (alive) setData(d);
      } catch {
        if (alive) setErr("Could not load the assembly-wise breakdown.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-bold text-gray-700 mt-2">Assembly-wise Breakdown</h2>
      {loading ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 flex items-center justify-center text-gray-400">
          <Loader2 className="animate-spin" size={22} />
        </div>
      ) : err ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center text-sm text-gray-500">{err}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AssemblyBarChart kind="workers" title="Worker by Assembly" icon={Layers} rows={data?.workers || []} dataKey="workers" unitLabel="Workers" color="#164FA3"
            note={data?.workers_overall ? (
              <p className="text-xs text-gray-600 mb-2" data-testid="assembly-worker-reconciliation">
                Total workers <strong className="text-gray-900">{data.workers_overall.total.toLocaleString("en-IN")}</strong> = in an assembly{" "}
                <strong className="text-gray-900">{data.workers_overall.sum_of_assemblies.toLocaleString("en-IN")}</strong> + not mapped to an assembly{" "}
                <strong className="text-gray-900">{data.workers_overall.unmapped.toLocaleString("en-IN")}</strong>
                {data.workers_overall.unmapped > 0 ? ` (${data.workers_overall.no_assembly.toLocaleString("en-IN")} with no assembly, ${data.workers_overall.invalid_assembly.toLocaleString("en-IN")} with an invalid one)` : ""}.
              {data.workers_overall.duplicates_excluded > 0 ? ` Counted once per person: ${data.workers_overall.duplicates_excluded.toLocaleString("en-IN")} repeat contact record${data.workers_overall.duplicates_excluded === 1 ? "" : "s"} of the same number not counted.` : ""}
              </p>
            ) : null} />
          <AssemblyBarChart kind="influencers" title="Influencer by Assembly" icon={Star} rows={data?.influencers || []} dataKey="influencers" unitLabel="Influencers" color="#22a45d"
            totalOverride={data?.influencers_overall?.total}
            note={data?.influencers_overall ? (
              <p className="text-xs text-gray-600 mb-2" data-testid="assembly-influencer-reconciliation">
                Total influencers <strong className="text-gray-900">{data.influencers_overall.total.toLocaleString("en-IN")}</strong> = in an assembly{" "}
                <strong className="text-gray-900">{data.influencers_overall.sum_of_assemblies.toLocaleString("en-IN")}</strong> + not mapped to an assembly{" "}
                <strong className="text-gray-900">{data.influencers_overall.unmapped.toLocaleString("en-IN")}</strong>
                {data.influencers_overall.unmapped > 0 ? ` (${data.influencers_overall.no_assembly.toLocaleString("en-IN")} with no assembly, ${data.influencers_overall.invalid_assembly.toLocaleString("en-IN")} with an invalid one)` : ""}.
              </p>
            ) : null} />
        </div>
      )}
    </div>
  );
}
