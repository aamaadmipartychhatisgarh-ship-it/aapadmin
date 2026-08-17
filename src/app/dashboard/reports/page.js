"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import PageHeader from "@/components/PageHeader";
import CollapsibleSection from "@/components/CollapsibleSection";
import FilterMultiSelect from "@/components/FilterMultiSelect";
import { formatDate, formatDateTime } from "@/lib/dateFormat";
import {
  FileText, Search, Download, FileSpreadsheet, Printer, Table as TableIcon, BarChart3,
  ListFilter, Save, ChevronLeft, ChevronRight, X, ArrowUpDown, Loader2,
  PhoneCall, Contact, Users, ClipboardList, MessageSquareWarning, Clock,
  UserCog, Network, Bell, ScrollText, PhoneOff, Calendar as CalendarIcon,
} from "lucide-react";

const ICONS = {
  PhoneCall, Contact, Users, ClipboardList, MessageSquareWarning, Clock,
  UserCog, Network, Bell, ScrollText, PhoneOff,
};

export default function Page() {
  return <SupervisorGuard><ReportsCenter /></SupervisorGuard>;
}

const inp = "h-9 px-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 outline-none focus:border-[#164FA3] focus:ring-1 focus:ring-[#164FA3]";
const PRINT_PAYLOAD_KEY = "reports_print_payload";
const emptyGeo = () => ({ zone_id: [], lok_sabha_id: [], district_id: [], assembly_id: [], ward_id: [], booth_id: [] });

// Fetch a level's location options, narrowed to children of `parentIds` when
// Parse a fetch Response as JSON only when it actually succeeded AND is JSON.
// A 504/500 gateway page is HTML, and blindly calling r.json() on it throws
// "Unexpected character at line 1 column 1" — masking the real status. This
// surfaces the HTTP error (with the server's message when the body is JSON)
// instead, so callers can show a real error + Retry rather than a parse crash.
async function jsonOrThrow(r) {
  const ct = r.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const data = isJson ? await r.json().catch(() => null) : null;
  if (!r.ok) {
    const msg = data?.message
      || (r.status === 504 || r.status === 502 ? "The server took too long to respond. Please retry."
        : r.status === 401 ? "Your session has expired. Please sign in again."
        : r.status === 403 ? "You do not have access to this report."
        : `Request failed (${r.status}).`);
    throw new Error(msg);
  }
  return data ?? {};
}

// any are selected — otherwise the full list. Multi-select-aware version of
// the single-parent cascades used elsewhere (Contacts).
async function fetchLocations(type, parentIds) {
  if (!parentIds || parentIds.length === 0) {
    const d = await fetch(`/api/locations?type=${type}`).then(jsonOrThrow).catch(() => ({}));
    return d.locations || [];
  }
  const lists = await Promise.all(
    parentIds.map((id) => fetch(`/api/locations?parent_id=${id}`).then(jsonOrThrow).then((d) => d.locations || []).catch(() => []))
  );
  const merged = new Map();
  for (const list of lists) for (const loc of list) if (loc.type === type) merged.set(loc.id, loc);
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function ReportsCenter() {
  const [boot, setBoot] = useState(null);        // { modules, timePresets, users }
  const [moduleKey, setModuleKey] = useState(null);
  const [meta, setMeta] = useState(null);        // per-module meta
  const [view, setView] = useState("table");     // table | summary | chart | calendar
  const [groupBy, setGroupBy] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  // Filters
  const [time, setTime] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filters, setFilters] = useState({});
  const [geo, setGeo] = useState(emptyGeo());
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(null);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [zones, setZones] = useState([]);
  const [lokSabhas, setLokSabhas] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [assemblies, setAssemblies] = useState([]);
  const [wards, setWards] = useState([]);
  const [booths, setBooths] = useState([]);

  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);   // initial /api/reports load
  const [bootErr, setBootErr] = useState("");      // initial-load failure (retryable)
  const [exporting, setExporting] = useState("");
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");        // transient success message (exports)
  const [saved, setSaved] = useState([]);

  // Filter panel: expanded by default so it's visible on arrival, then
  // auto-collapses ONCE the first result for this module loads — so it
  // stops covering the report — without fighting the user if they reopen
  // it and keep adjusting filters. Re-expands + re-arms on module switch.
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  const autoCollapsedRef = useRef(false);

  // ---- bootstrap (retryable) --------------------------------------------
  const loadBoot = useCallback(() => {
    setBooting(true); setBootErr("");
    fetch("/api/reports").then(jsonOrThrow).then((d) => {
      setBoot(d);
      // Deep-link support: /dashboard/reports?module=tasks opens straight to
      // that module (used by the Dashboard's Reports Summary tiles).
      const requested = new URLSearchParams(window.location.search).get("module");
      const initial = (requested && d.modules?.some((m) => m.key === requested)) ? requested : d.modules?.[0]?.key;
      if (initial) setModuleKey(initial);
    }).catch((e) => setBootErr(e.message || "Failed to load reports"))
      .finally(() => setBooting(false));
    // Zones load independently — a location hiccup must not block the report UI.
    fetchLocations("zone", []).then(setZones).catch(() => {});
  }, []);
  useEffect(() => { loadBoot(); }, [loadBoot]);
  // Auto-dismiss the transient export success message.
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(""), 4000); return () => clearTimeout(t); }, [notice]);

  // ---- module meta (resets filters) --------------------------------------
  useEffect(() => {
    if (!moduleKey) return;
    setMeta(null); setResult(null);
    setFilters({}); setGeo(emptyGeo()); setSearch("");
    setGroupBy(""); setSort(null); setPage(1); setView("table");
    setFiltersExpanded(true); autoCollapsedRef.current = false;
    fetch(`/api/reports?module=${moduleKey}`).then(jsonOrThrow).then((d) => setMeta(d.meta)).catch((e) => setErr(e.message || "Failed to load module"));
    fetch(`/api/reports/saved-filters?module=${moduleKey}`).then(jsonOrThrow).then((d) => setSaved(d.saved || [])).catch(() => setSaved([]));
  }, [moduleKey]);

  // ---- geo cascade (multi-select: narrows to children of selected parents,
  // drops any selection that's no longer a valid child when the parent changes) ----
  useEffect(() => {
    fetchLocations("lok_sabha", geo.zone_id).then((list) => {
      setLokSabhas(list);
      setGeo((g) => ({ ...g, lok_sabha_id: g.lok_sabha_id.filter((id) => list.some((l) => String(l.id) === String(id))) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.zone_id]);
  useEffect(() => {
    fetchLocations("district", geo.lok_sabha_id).then((list) => {
      setDistricts(list);
      setGeo((g) => ({ ...g, district_id: g.district_id.filter((id) => list.some((l) => String(l.id) === String(id))) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.lok_sabha_id]);
  useEffect(() => {
    fetchLocations("assembly", geo.district_id).then((list) => {
      setAssemblies(list);
      setGeo((g) => ({ ...g, assembly_id: g.assembly_id.filter((id) => list.some((l) => String(l.id) === String(id))) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.district_id]);
  useEffect(() => {
    fetchLocations("ward", geo.assembly_id).then((list) => {
      setWards(list);
      setGeo((g) => ({ ...g, ward_id: g.ward_id.filter((id) => list.some((l) => String(l.id) === String(id))) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.assembly_id]);
  useEffect(() => {
    fetchLocations("booth", geo.ward_id).then((list) => {
      setBooths(list);
      setGeo((g) => ({ ...g, booth_id: g.booth_id.filter((id) => list.some((l) => String(l.id) === String(id))) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.ward_id]);

  // Calendar view groups by day over the selected month, independent of the
  // Time Range filter (which stays available for the other views).
  const monthBounds = useMemo(() => {
    const [y, m] = calendarMonth.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    return { from: `${calendarMonth}-01`, to: `${calendarMonth}-${String(daysInMonth).padStart(2, "0")}`, daysInMonth };
  }, [calendarMonth]);

  const body = useMemo(() => ({
    module: moduleKey,
    time: view === "calendar" ? "custom" : time,
    date_from: view === "calendar" ? monthBounds.from : dateFrom,
    date_to: view === "calendar" ? monthBounds.to : dateTo,
    filters,
    geo,
    search,
    group_by: view === "table" ? "" : view === "calendar" ? "day" : groupBy,
    sort, page, pageSize,
  }), [moduleKey, time, dateFrom, dateTo, filters, geo, search, view, groupBy, sort, page, monthBounds]);

  // ---- run report (debounced) --------------------------------------------
  const run = useCallback(() => {
    if (!moduleKey || !meta) return;
    if ((view === "summary" || view === "chart") && !groupBy) { setResult(null); return; }
    setLoading(true); setErr("");
    fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(jsonOrThrow)
      .then((r) => {
        setResult(r);
        // Auto-hide the filter panel the first time this module's results
        // land, so it stops covering the report. Only once per module —
        // reopening it afterward (the up/down button) won't auto-close again.
        if (!autoCollapsedRef.current) { autoCollapsedRef.current = true; setFiltersExpanded(false); }
      })
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

  // ---- export: CSV / Excel / PDF, always the FULL filtered result set ----
  const downloadExport = async (format, bodyOverride) => {
    if (!moduleKey) return;
    // `exporting` tags the in-flight button; use a distinct tag for the "today"
    // variant so its spinner shows on the right button.
    const tag = bodyOverride?.__tag || format;
    setExporting(tag); setErr(""); setNotice("");
    // Client-side abort so the button can NEVER stay stuck if the server hangs.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const payload = { ...body, ...bodyOverride };
      delete payload.__tag;
      const r = await fetch(`/api/reports/export?format=${format}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal,
      });
      if (!r.ok) {
        // Errors are always JSON now; fall back to a status message if not.
        const ct = r.headers.get("content-type") || "";
        const msg = ct.includes("application/json")
          ? ((await r.json().catch(() => ({}))).message || "Export failed.")
          : `Export failed (${r.status}).`;
        throw new Error(msg);
      }
      const blob = await r.blob();
      if (!blob || blob.size === 0) throw new Error("The export came back empty. Please try again.");
      const cd = r.headers.get("Content-Disposition") || "";
      const filename = cd.match(/filename="([^"]+)"/)?.[1] || `${moduleKey}-report.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      setNotice(`${format === "analytical" ? "Analytical PDF" : format.toUpperCase()} downloaded.`);
    } catch (e) {
      setErr(e.name === "AbortError" ? "Export timed out. Please narrow the filters and try again." : (e.message || "Export failed."));
    } finally {
      clearTimeout(timer);
      setExporting("");
    }
  };

  // Print opens a dedicated, chrome-free print view in a new tab — the
  // filter config is handed off via sessionStorage (not the URL: a
  // multi-select filter set is too big/awkward for a query string).
  const openPrint = () => {
    try { sessionStorage.setItem(PRINT_PAYLOAD_KEY, JSON.stringify({ body, orientation: "landscape" })); } catch {}
    window.open("/reports-print", "_blank");
  };

  const saveCurrent = async () => {
    const name = prompt("Save this report as:");
    if (!name) return;
    const config = { view, groupBy, time, dateFrom, dateTo, filters, geo, search };
    const r = await fetch("/api/reports/saved-filters", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ module: moduleKey, name, config }),
    });
    if (r.ok) {
      const d = await r.json();
      setSaved((prev) => [...prev.filter((s) => s.name !== name), d.saved].sort((a, b) => a.name.localeCompare(b.name)));
    } else {
      setErr((await r.json().catch(() => ({}))).message || "Save failed");
    }
  };
  const loadSaved = (s) => {
    const c = s.config || {};
    setView(c.view || "table"); setGroupBy(c.groupBy || ""); setTime(c.time || "all");
    setDateFrom(c.dateFrom || ""); setDateTo(c.dateTo || ""); setFilters(c.filters || {});
    setGeo({ ...emptyGeo(), ...(c.geo || {}) }); setSearch(c.search || ""); setPage(1);
  };
  const deleteSaved = async (s) => {
    const r = await fetch(`/api/reports/saved-filters/${s.id}`, { method: "DELETE" });
    if (r.ok) setSaved((prev) => prev.filter((x) => x.id !== s.id));
  };

  const totalPages = result?.mode === "detail" ? Math.max(1, Math.ceil(result.total / pageSize)) : 1;

  const asItems = (options) => (options || []).map((o) => ({ id: o.value, name: o.label }));

  // Initial load: show a skeleton while /api/reports is in flight, and a
  // friendly error + Retry if it fails — never a blank screen or a premature
  // "Failed" before the request has actually finished.
  if (booting) {
    return (
      <div className="space-y-5 animate-in fade-in duration-500">
        <PageHeader icon={FileText} title="Reports Center" description="Loading reports…" breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "Analytics" }, { label: "Reports" }]} />
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 flex items-center justify-center text-gray-400">
          <Loader2 className="animate-spin mr-2" size={18} /> Loading reports…
        </div>
      </div>
    );
  }
  if (bootErr) {
    return (
      <div className="space-y-5 animate-in fade-in duration-500">
        <PageHeader icon={FileText} title="Reports Center" description="One engine for every module — filter, group, chart and export." breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "Analytics" }, { label: "Reports" }]} />
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center">
          <div className="text-red-700 font-semibold">{bootErr}</div>
          <button onClick={loadBoot} className="mt-3 inline-flex items-center gap-2 bg-[#164FA3] hover:bg-blue-800 text-white px-4 py-2 rounded-lg text-sm font-semibold">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <PageHeader
        icon={FileText}
        title="Reports Center"
        description="One engine for every module — filter, group, chart and export. New modules appear here automatically."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "Analytics" }, { label: "Reports" }]}
      />

      {notice && (
        <div className="fixed top-4 right-4 z-[80] bg-emerald-600 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg">{notice}</div>
      )}

      {/* Module picker */}
      <div className="flex items-center gap-2">
        {(() => {
          const activeModule = modules.find((m) => m.key === moduleKey);
          const ActiveIcon = activeModule ? ICONS[activeModule.icon] || FileText : FileText;
          return <ActiveIcon size={18} className="text-[#164FA3] shrink-0" />;
        })()}
        <select
          className="h-11 px-3.5 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-900 outline-none focus:border-[#164FA3] focus:ring-1 focus:ring-[#164FA3] min-w-[220px]"
          value={moduleKey || ""}
          onChange={(e) => setModuleKey(e.target.value)}
        >
          {modules.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Filter bar — expands/hides so it doesn't cover the report below;
          auto-hides once results load (see the run() callback above). */}
      <CollapsibleSection title="Search & Filters" expanded={filtersExpanded} onToggle={setFiltersExpanded}>
        <div className="flex flex-wrap items-end gap-3">
          {view !== "calendar" && (
          <Field label="Time range">
            <select className={inp} value={time} onChange={(e) => { setTime(e.target.value); setPage(1); }}>
              {(boot?.timePresets || []).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </Field>
          )}
          {view !== "calendar" && time === "custom" && (
            <>
              <Field label="From"><input type="date" className={inp} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></Field>
              <Field label="To"><input type="date" className={inp} value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></Field>
            </>
          )}

          {meta?.geo && (
            <>
              <Field label="Zone">
                <FilterMultiSelect label="zones" items={zones.map((z) => ({ id: z.id, name: z.name }))} selected={geo.zone_id} onChange={(v) => { setGeo((g) => ({ ...g, zone_id: v })); setPage(1); }} />
              </Field>
              <Field label="Lok Sabha">
                <FilterMultiSelect label="Lok Sabhas" items={lokSabhas.map((l) => ({ id: l.id, name: l.name }))} selected={geo.lok_sabha_id} onChange={(v) => { setGeo((g) => ({ ...g, lok_sabha_id: v })); setPage(1); }} />
              </Field>
              <Field label="District">
                <FilterMultiSelect label="districts" items={districts.map((d) => ({ id: d.id, name: d.name }))} selected={geo.district_id} onChange={(v) => { setGeo((g) => ({ ...g, district_id: v })); setPage(1); }} />
              </Field>
              <Field label="Assembly">
                <FilterMultiSelect label="assemblies" items={assemblies.map((a) => ({ id: a.id, name: a.name }))} selected={geo.assembly_id} onChange={(v) => { setGeo((g) => ({ ...g, assembly_id: v })); setPage(1); }} />
              </Field>
              <Field label="Block">
                <FilterMultiSelect label="blocks" items={wards.map((w) => ({ id: w.id, name: w.name }))} selected={geo.ward_id} onChange={(v) => { setGeo((g) => ({ ...g, ward_id: v })); setPage(1); }} />
              </Field>
              <Field label="Booth">
                <FilterMultiSelect label="booths" items={booths.map((b) => ({ id: b.id, name: b.name }))} selected={geo.booth_id} onChange={(v) => { setGeo((g) => ({ ...g, booth_id: v })); setPage(1); }} />
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
                <FilterMultiSelect label={f.label.toLowerCase()} items={(boot?.users || []).map((u) => ({ id: u.id, name: u.username }))} selected={filters[f.key] || []} onChange={(v) => setFilter(f.key, v)} />
              ) : (f.type === "enum" || f.type === "m2m") ? (
                <FilterMultiSelect label={f.label.toLowerCase()} items={asItems(f.options)} selected={filters[f.key] || []} onChange={(v) => setFilter(f.key, v)} />
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
      </CollapsibleSection>

      {/* View + group + actions — always visible, even while filters are collapsed */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {[["table", "Table", TableIcon], ["summary", "Summary", ListFilter], ["chart", "Chart", BarChart3], ["calendar", "Calendar", CalendarIcon]].map(([v, label, Icon]) => (
              <button key={v} onClick={() => { setView(v); setPage(1); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${view === v ? "bg-[#164FA3] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>

          {(view === "summary" || view === "chart") && (
            <select className={inp} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="">Group by…</option>
              {(meta?.groupBy || []).map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          )}

          {view === "calendar" && (
            <div className="flex items-center gap-1 h-9 px-1 rounded-lg border border-gray-200 bg-white">
              <button onClick={() => setCalendarMonth((m) => shiftMonth(m, -1))} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500"><ChevronLeft size={15} /></button>
              <span className="text-sm font-medium text-gray-700 px-1.5 min-w-[8rem] text-center">{monthLabel(calendarMonth)}</span>
              <button onClick={() => setCalendarMonth((m) => shiftMonth(m, 1))} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500"><ChevronRight size={15} /></button>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <button onClick={saveCurrent} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-200 text-gray-700 hover:bg-gray-50"><Save size={15} /> Save</button>
            <button onClick={() => downloadExport("csv")} disabled={!result || !!exporting} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40">
              {exporting === "csv" ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} CSV
            </button>
            <button onClick={() => downloadExport("xlsx")} disabled={!result || !!exporting} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40">
              {exporting === "xlsx" ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />} Excel
            </button>
            {/* Full analytical PDF — KPIs + per-day chart + breakdowns (by status,
                assembly, caller, designation…) for the current filters. */}
            <button onClick={() => downloadExport("analytical")} disabled={!result || !!exporting} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-[#164FA3] text-white hover:bg-blue-800 disabled:opacity-40">
              {exporting === "analytical" ? <Loader2 size={15} className="animate-spin" /> : <BarChart3 size={15} />} Analytical PDF
            </button>
            {/* One-click: today's data as an analytical PDF, regardless of the
                currently selected time range. */}
            <button onClick={() => downloadExport("analytical", { time: "today", date_from: undefined, date_to: undefined, __tag: "today" })} disabled={!moduleKey || !!exporting} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-[#164FA3] text-[#164FA3] hover:bg-blue-50 disabled:opacity-40">
              {exporting === "today" ? <Loader2 size={15} className="animate-spin" /> : <CalendarIcon size={15} />} Today's Report
            </button>
            <button onClick={openPrint} disabled={!result} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40"><Printer size={15} /> Print</button>
          </div>
        </div>

        {saved.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-gray-400">Saved:</span>
            {saved.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-gray-100 text-xs text-gray-700">
                <button onClick={() => loadSaved(s)} className="hover:text-[#164FA3]">{s.name}</button>
                <button onClick={() => deleteSaved(s)} className="text-gray-400 hover:text-red-500"><X size={12} /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden min-h-[200px]">
        {err && !loading && (
          <div className="p-6 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm text-red-600">{err}</span>
            <button onClick={run} className="inline-flex items-center gap-2 bg-[#164FA3] hover:bg-blue-800 text-white px-3.5 py-2 rounded-lg text-sm font-semibold">Retry</button>
          </div>
        )}
        {loading && <div className="p-10 flex items-center justify-center text-gray-400"><Loader2 className="animate-spin mr-2" size={18} /> Loading…</div>}

        {!loading && (view === "summary" || view === "chart") && !groupBy && (
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
                {result.rows.length > 0 && (
                  <tfoot>
                    <tr className="bg-gray-50 font-semibold text-gray-900">
                      <td className="px-4 py-2.5">Total — {result.rows.length} groups</td>
                      <td className="px-4 py-2.5 text-right">{result.totalRecords.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-2.5" />
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
        )}

        {!loading && !err && result?.mode === "summary" && view === "calendar" && (
          <MonthCalendar month={calendarMonth} rows={result.rows} daysInMonth={monthBounds.daysInMonth} />
        )}
      </div>
    </div>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function shiftMonth(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

// Month-grid heatmap: one cell per day, colored by call/record volume for that
// day (darker = busier). Data comes from the engine's day-grouped summary —
// group_key is the 'YYYY-MM-DD' string the SQL DATE(...) produces.
function MonthCalendar({ month, rows, daysInMonth }) {
  const [y, m] = month.split("-").map(Number);
  const firstWeekday = new Date(y, m - 1, 1).getDay();
  const counts = {};
  let max = 1;
  for (const r of rows) {
    const day = Number(String(r.group_key).slice(-2));
    counts[day] = r.count;
    if (r.count > max) max = r.count;
  }
  const todayKey = new Date();
  const isToday = (day) => todayKey.getFullYear() === y && todayKey.getMonth() + 1 === m && todayKey.getDate() === day;

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);

  return (
    <div className="p-4">
      <div className="grid grid-cols-7 gap-2 mb-2">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center text-xs font-semibold text-gray-400 py-1">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {cells.map((day, i) => {
          if (day === null) return <div key={`e${i}`} />;
          const count = counts[day] || 0;
          const intensity = count === 0 ? 0 : Math.max(0.12, count / max);
          return (
            <div
              key={day}
              title={`${count.toLocaleString("en-IN")} records`}
              className={`aspect-square rounded-lg border flex flex-col items-center justify-center gap-0.5 ${
                isToday(day) ? "border-[#164FA3]" : "border-gray-100"
              }`}
              style={count > 0 ? { backgroundColor: `rgba(22, 79, 163, ${intensity})` } : undefined}
            >
              <span className={`text-xs font-semibold ${intensity > 0.5 ? "text-white" : "text-gray-500"}`}>{day}</span>
              {count > 0 && (
                <span className={`text-[11px] font-bold ${intensity > 0.5 ? "text-white" : "text-[#164FA3]"}`}>{count}</span>
              )}
            </div>
          );
        })}
      </div>
      {rows.length === 0 && <div className="py-10 text-center text-gray-400 text-sm">No data this month.</div>}
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
