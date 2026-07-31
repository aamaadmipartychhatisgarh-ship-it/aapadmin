"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import PageHeader from "@/components/PageHeader";
import { formatDate, formatDateTime } from "@/lib/dateFormat";
import {
  FileText, Search, Download, Printer, Table as TableIcon, BarChart3,
  ListFilter, Save, ChevronLeft, ChevronRight, X, ArrowUpDown, Loader2,
  PhoneCall, Contact, Users, ClipboardList, MessageSquareWarning, Clock,
  UserCog, Network, Bell, ScrollText,
} from "lucide-react";

const ICONS = {
  PhoneCall, Contact, Users, ClipboardList, MessageSquareWarning, Clock,
  UserCog, Network, Bell, ScrollText,
};

export default function Page() {
  return <SupervisorGuard><ReportsCenter /></SupervisorGuard>;
}

const inp = "h-9 px-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 outline-none focus:border-[#164FA3] focus:ring-1 focus:ring-[#164FA3]";
const SAVED_KEY = "reports_saved_v1";

function ReportsCenter() {
  const [boot, setBoot] = useState(null);        // { modules, timePresets, users }
  const [moduleKey, setModuleKey] = useState(null);
  const [meta, setMeta] = useState(null);        // per-module meta
  const [view, setView] = useState("table");     // table | summary | chart
  const [groupBy, setGroupBy] = useState("");

  // Filters
  const [time, setTime] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filters, setFilters] = useState({});
  const [geo, setGeo] = useState({ district_id: "", assembly_id: "" });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(null);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [districts, setDistricts] = useState([]);
  const [assemblies, setAssemblies] = useState([]);

  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState([]);

  // ---- bootstrap ---------------------------------------------------------
  useEffect(() => {
    fetch("/api/reports").then((r) => r.json()).then((d) => {
      setBoot(d);
      if (d.modules?.length) setModuleKey(d.modules[0].key);
    }).catch(() => setErr("Failed to load reports"));
    fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || [])).catch(() => {});
    try { setSaved(JSON.parse(localStorage.getItem(SAVED_KEY) || "[]")); } catch {}
  }, []);

  // ---- module meta (resets filters) --------------------------------------
  useEffect(() => {
    if (!moduleKey) return;
    setMeta(null); setResult(null);
    setFilters({}); setGeo({ district_id: "", assembly_id: "" }); setSearch("");
    setGroupBy(""); setSort(null); setPage(1); setView("table");
    fetch(`/api/reports?module=${moduleKey}`).then((r) => r.json()).then((d) => setMeta(d.meta)).catch(() => setErr("Failed to load module"));
  }, [moduleKey]);

  // ---- assemblies cascade on district ------------------------------------
  useEffect(() => {
    if (!geo.district_id) { setAssemblies([]); return; }
    fetch(`/api/locations?type=assembly&parent_id=${geo.district_id}`).then((r) => r.json()).then((d) => setAssemblies(d.locations || [])).catch(() => setAssemblies([]));
  }, [geo.district_id]);

  const body = useMemo(() => ({
    module: moduleKey,
    time, date_from: dateFrom, date_to: dateTo,
    filters,
    geo: { district_id: geo.district_id || undefined, assembly_id: geo.assembly_id || undefined },
    search,
    group_by: view === "table" ? "" : groupBy,
    sort, page, pageSize,
  }), [moduleKey, time, dateFrom, dateTo, filters, geo, search, view, groupBy, sort, page]);

  // ---- run report (debounced) --------------------------------------------
  const run = useCallback(() => {
    if (!moduleKey || !meta) return;
    if (view !== "table" && !groupBy) { setResult(null); return; }
    setLoading(true); setErr("");
    fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async (r) => { if (!r.ok) throw new Error((await r.json()).message || "Failed"); return r.json(); })
      .then(setResult)
      .catch((e) => { setErr(e.message); setResult(null); })
      .finally(() => setLoading(false));
  }, [moduleKey, meta, view, groupBy, body]);

  useEffect(() => {
    const id = setTimeout(run, 250);
    return () => clearTimeout(id);
  }, [run]);

  // ---- helpers -----------------------------------------------------------
  const modules = boot?.modules || [];
  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  const toggleSort = (key) => setSort((s) => s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" });

  const fmtVal = (col, v) => {
    if (v === null || v === undefined || v === "") return <span className="text-gray-300">—</span>;
    if (col.type === "bool") return v == 1 ? "Yes" : "No";
    if (col.type === "datetime") return formatDateTime(v);
    if (col.type === "date") return formatDate(v);
    return String(v);
  };

  const exportCSV = () => {
    if (!result) return;
    let head, lines;
    if (result.mode === "summary") {
      head = [result.group_label, "Count"];
      lines = result.rows.map((r) => [r.group_key, r.count]);
    } else {
      head = result.columns.map((c) => c.label);
      lines = result.rows.map((row) => result.columns.map((c) => row[c.key] ?? ""));
    }
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const csv = [head.map(esc).join(","), ...lines.map((l) => l.map(esc).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${moduleKey}-report.csv`;
    a.click();
  };

  const saveCurrent = () => {
    const name = prompt("Save this report as:");
    if (!name) return;
    const entry = { name, moduleKey, view, groupBy, time, dateFrom, dateTo, filters, geo, search };
    const next = [...saved.filter((s) => s.name !== name), entry];
    setSaved(next);
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch {}
  };
  const loadSaved = (s) => {
    setModuleKey(s.moduleKey);
    // apply the rest after meta loads
    setTimeout(() => {
      setView(s.view); setGroupBy(s.groupBy); setTime(s.time);
      setDateFrom(s.dateFrom); setDateTo(s.dateTo); setFilters(s.filters || {});
      setGeo(s.geo || { district_id: "", assembly_id: "" }); setSearch(s.search || ""); setPage(1);
    }, 300);
  };
  const deleteSaved = (name) => {
    const next = saved.filter((s) => s.name !== name);
    setSaved(next);
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch {}
  };

  const totalPages = result?.mode === "detail" ? Math.max(1, Math.ceil(result.total / pageSize)) : 1;

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <PageHeader
        icon={FileText}
        title="Reports Center"
        description="One engine for every module — filter, group, chart and export. New modules appear here automatically."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "Analytics" }, { label: "Reports" }]}
      />

      {/* Module picker */}
      <div className="flex flex-wrap gap-2">
        {modules.map((m) => {
          const Icon = ICONS[m.icon] || FileText;
          const active = m.key === moduleKey;
          return (
            <button key={m.key} onClick={() => setModuleKey(m.key)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium border transition-colors ${
                active ? "bg-[#164FA3] text-white border-[#164FA3]" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}>
              <Icon size={16} /> {m.label}
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Time range">
            <select className={inp} value={time} onChange={(e) => { setTime(e.target.value); setPage(1); }}>
              {(boot?.timePresets || []).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </Field>
          {time === "custom" && (
            <>
              <Field label="From"><input type="date" className={inp} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></Field>
              <Field label="To"><input type="date" className={inp} value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></Field>
            </>
          )}

          {meta?.geo && (
            <>
              <Field label="District">
                <select className={inp} value={geo.district_id} onChange={(e) => { setGeo({ district_id: e.target.value, assembly_id: "" }); setPage(1); }}>
                  <option value="">All districts</option>
                  {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="Assembly">
                <select className={inp} value={geo.assembly_id} disabled={!geo.district_id} onChange={(e) => { setGeo((g) => ({ ...g, assembly_id: e.target.value })); setPage(1); }}>
                  <option value="">All assemblies</option>
                  {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
            </>
          )}

          {(meta?.filters || []).map((f) => (
            <Field key={f.key} label={f.label}>
              {f.type === "bool" ? (
                <select className={inp} value={filters[f.key] ?? ""} onChange={(e) => setFilter(f.key, e.target.value)}>
                  <option value="">Any</option><option value="1">Yes</option><option value="0">No</option>
                </select>
              ) : f.type === "user" ? (
                <select className={inp} value={filters[f.key] ?? ""} onChange={(e) => setFilter(f.key, e.target.value)}>
                  <option value="">All</option>
                  {(boot?.users || []).map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
                </select>
              ) : f.type === "enum" ? (
                <select className={inp} value={filters[f.key] ?? ""} onChange={(e) => setFilter(f.key, e.target.value)}>
                  <option value="">All</option>
                  {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input className={inp} placeholder={f.label} value={filters[f.key] ?? ""} onChange={(e) => setFilter(f.key, e.target.value)} />
              )}
            </Field>
          ))}

          <Field label="Search">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className={`${inp} pl-8 w-52`} placeholder="Name, phone, keyword…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            </div>
          </Field>
        </div>

        {/* View + group + actions */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-gray-100">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {[["table", "Table", TableIcon], ["summary", "Summary", ListFilter], ["chart", "Chart", BarChart3]].map(([v, label, Icon]) => (
              <button key={v} onClick={() => { setView(v); setPage(1); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${view === v ? "bg-[#164FA3] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>

          {view !== "table" && (
            <select className={inp} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="">Group by…</option>
              {(meta?.groupBy || []).map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button onClick={saveCurrent} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-200 text-gray-700 hover:bg-gray-50"><Save size={15} /> Save</button>
            <button onClick={exportCSV} disabled={!result} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40"><Download size={15} /> CSV</button>
            <button onClick={() => window.print()} disabled={!result} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40"><Printer size={15} /> Print</button>
          </div>
        </div>

        {saved.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-gray-400">Saved:</span>
            {saved.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-gray-100 text-xs text-gray-700">
                <button onClick={() => loadSaved(s)} className="hover:text-[#164FA3]">{s.name}</button>
                <button onClick={() => deleteSaved(s.name)} className="text-gray-400 hover:text-red-500"><X size={12} /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden min-h-[200px]">
        {err && <div className="p-6 text-sm text-red-600">{err}</div>}
        {loading && <div className="p-10 flex items-center justify-center text-gray-400"><Loader2 className="animate-spin mr-2" size={18} /> Loading…</div>}

        {!loading && view !== "table" && !groupBy && (
          <div className="p-10 text-center text-gray-400 text-sm">Choose a “Group by” dimension to see the {view}.</div>
        )}

        {!loading && !err && result?.mode === "detail" && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-left">
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c.key} className="px-4 py-3 font-medium whitespace-nowrap">
                        <button onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-gray-800">
                          {c.label} <ArrowUpDown size={12} className={sort?.key === c.key ? "text-[#164FA3]" : "text-gray-300"} />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      {result.columns.map((c) => <td key={c.key} className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{fmtVal(c, row[c.key])}</td>)}
                    </tr>
                  ))}
                  {result.rows.length === 0 && (
                    <tr><td colSpan={result.columns.length} className="px-4 py-10 text-center text-gray-400">No records match these filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
              <span>{result.total === 0 ? "0" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, result.total)}`} of {result.total.toLocaleString("en-IN")}</span>
              <div className="flex items-center gap-1">
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronLeft size={16} /></button>
                <span className="px-2">Page {page} / {totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronRight size={16} /></button>
              </div>
            </div>
          </>
        )}

        {!loading && !err && result?.mode === "summary" && groupBy && (
          <div className="p-4">
            <div className="text-xs text-gray-400 mb-3">{result.groups} groups · {result.totalRecords.toLocaleString("en-IN")} records · by {result.group_label}</div>
            {view === "chart" ? (
              <div className="space-y-2">
                {result.rows.map((r, i) => {
                  const max = result.rows[0]?.count || 1;
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-40 truncate text-sm text-gray-600 text-right shrink-0">{r.group_key}</div>
                      <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                        <div className="h-full bg-[#164FA3] rounded-full flex items-center justify-end px-2 text-[11px] text-white font-medium" style={{ width: `${Math.max(4, (r.count / max) * 100)}%` }}>{r.count.toLocaleString("en-IN")}</div>
                      </div>
                    </div>
                  );
                })}
                {result.rows.length === 0 && <div className="py-10 text-center text-gray-400 text-sm">No data.</div>}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-left"><tr><th className="px-4 py-3 font-medium">{result.group_label}</th><th className="px-4 py-3 font-medium text-right">Count</th><th className="px-4 py-3 font-medium w-1/2">Share</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {result.rows.map((r, i) => {
                    const pct = result.totalRecords ? (r.count / result.totalRecords) * 100 : 0;
                    return (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-gray-700">{r.group_key}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-900">{r.count.toLocaleString("en-IN")}</td>
                        <td className="px-4 py-2.5"><div className="bg-gray-100 rounded-full h-2"><div className="h-full bg-[#164FA3] rounded-full" style={{ width: `${pct}%` }} /></div></td>
                      </tr>
                    );
                  })}
                  {result.rows.length === 0 && <tr><td colSpan={3} className="px-4 py-10 text-center text-gray-400">No data.</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  );
}
