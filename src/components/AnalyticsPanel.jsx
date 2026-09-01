"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, LabelList,
} from "recharts";
import { Loader2, Filter, BarChart3, PieChart as PieIcon, TrendingUp, Layers, Activity, Grid3x3, Radio } from "lucide-react";
import { useLiveAnalytics } from "@/hooks/useLiveAnalytics";

const STATUS_COLORS = {
  "Phone Picked":   "#10B981",
  "Not Picked":     "#F59E0B",
  "Wrong Number":   "#6B7280",
  "Rudely Behaved": "#EF4444",
  "Busy":           "#8B5CF6",
  "Switched Off":   "#0EA5E9",
};
const ZONE_COLORS = {
  Raipur: "#164FA3", Bilaspur: "#10B981", Surguja: "#FCB712",
  Durg: "#EF4444", Bastar: "#8B5CF6",
};

// Full analytics charts suite — extracted from the old standalone /dashboard/analytics
// page so it can be embedded as a tab inside the Dashboard Overview (see
// dashboard/admin/page.js) without duplicating ~400 lines of chart code.
// /dashboard/analytics still renders this directly for roles that keep it in
// their own sidebar (e.g. supervisor).
export default function AnalyticsPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [districts, setDistricts] = useState([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  // Top Agents card has its OWN date filter, independent of the shared filter
  // bar above — so changing it refreshes ONLY the Top Agents chart, never the
  // other charts. Empty from/to = the default (all-time) period, same as before.
  const [taFrom, setTaFrom] = useState("");
  const [taTo, setTaTo] = useState("");
  const [taData, setTaData] = useState(null);
  const [taLoading, setTaLoading] = useState(true);
  // Silent background refetches (live-event/poll-triggered) skip the
  // full-panel loading spinner — only the very first load and explicit
  // filter changes should blank the charts out.
  const firstLoad = useRef(true);

  useEffect(() => {
    fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || []));
  }, []);

  const load = useCallback(() => {
    if (firstLoad.current) setLoading(true);
    const params = new URLSearchParams();
    if (dateFrom)   params.set("date_from", dateFrom);
    if (dateTo)     params.set("date_to", dateTo);
    if (districtId) params.set("district_id", districtId);
    fetch(`/api/analytics?${params}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLastUpdated(new Date()); })
      .finally(() => { setLoading(false); firstLoad.current = false; });
  }, [dateFrom, dateTo, districtId]);

  // Re-run whenever a filter changes (also covers the initial load).
  useEffect(() => { firstLoad.current = true; load(); }, [load]);

  // Top Agents: fetch ONLY this section for its own date range. Runs on mount
  // (default period) and whenever the card's date filter changes. `silent` skips
  // the loading spinner for background (live/poll) refreshes.
  const loadTopAgents = useCallback((silent = false) => {
    if (!silent) setTaLoading(true);
    const p = new URLSearchParams({ section: "top_agents" });
    if (taFrom) p.set("from", taFrom);
    if (taTo)   p.set("to", taTo);
    fetch(`/api/analytics?${p}`)
      .then((r) => (r.ok ? r.json() : { topAgents: [] }))
      .then((d) => setTaData(d))
      .catch(() => setTaData({ topAgents: [] }))
      .finally(() => setTaLoading(false));
  }, [taFrom, taTo]);
  useEffect(() => { loadTopAgents(); }, [loadTopAgents]);

  // Live refresh: SSE push (instant) + 60s safety-net poll + focus/visibility
  // refetch — see src/hooks/useLiveAnalytics.js for why all three are needed
  // on Hostinger's hosting. One handler refreshes the main charts and the Top
  // Agents card (the latter silently, keeping its own selected date range).
  const liveRefresh = useCallback(() => { load(); loadTopAgents(true); }, [load, loadTopAgents]);
  useLiveAnalytics(liveRefresh);

  const lineData = useMemo(() =>
    (data?.line || []).map((r) => ({ day: fmtDay(r.day), calls: Number(r.calls) })),
  [data]);

  const cumData = useMemo(() =>
    (data?.cumulative || []).map((r) => ({ day: fmtDay(r.day), cumulative: Number(r.cumulative_connected) })),
  [data]);

  const pieData = useMemo(() =>
    (data?.statusPie || []).filter((r) => r.status && r.n > 0).map((r) => ({
      name: r.status, value: Number(r.n), color: STATUS_COLORS[r.status] || "#9CA3AF",
    })),
  [data]);

  const stackedData = useMemo(() =>
    (data?.stackedDistrict || []).map((r) => ({
      district: r.district,
      Connected: Number(r.connected),
      "No Answer": Number(r.no_answer),
      "Wrong Number": Number(r.wrong_number),
      Rejected: Number(r.rejected),
      Busy: Number(r.busy),
      "Switched Off": Number(r.switched_off),
    })),
  [data]);

  // Top Agents bar data comes from the card's OWN date-scoped fetch (taData),
  // not the shared analytics payload, so its date filter is fully independent.
  const barData = useMemo(() =>
    (taData?.topAgents || []).map((r) => ({ agent: r.agent, calls: Number(r.calls), connected: Number(r.connected) })),
  [taData]);

  // Workers by Assembly — EVERY master assembly from the backend (all 90,
  // including zero-worker ones), each with its live Contacts-based worker count.
  const workersByAssembly = useMemo(() =>
    (data?.assemblyWorkers || []).map((a) => ({ assembly: a.assembly, workers: Number(a.workers) || 0 })),
  [data]);
  // Total worker count across all assemblies — consistent with the per-assembly
  // rows above (summed from the same dataset, never a separate query).
  const workersByAssemblyTotal = useMemo(() =>
    workersByAssembly.reduce((s, a) => s + a.workers, 0),
  [workersByAssembly]);

  // Date × hour heat map: an array of { day, hours: {10: n, …}, total } — one
  // row per actual calendar date in the window (zero-call days included).
  const heatmap = data?.heatmap || [];
  // Scale colours to the busiest office-hour cell actually shown.
  const heatmapMax = useMemo(() => {
    let m = 0;
    heatmap.forEach((row) => OFFICE_HOURS.forEach((h) => { const v = (row.hours?.[h]) || 0; if (v > m) m = v; }));
    return m;
  }, [heatmap]);

  return (
    <div className="space-y-6">
      {/* Shared filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2 text-gray-500 text-sm font-semibold mr-2">
          <Filter size={16} /> Filters:
        </div>
        <Field label="Date from">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Date to">
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
        </Field>
        <Field label="District">
          <select value={districtId} onChange={(e) => setDistrictId(e.target.value)} className={inputCls}>
            <option value="">All districts</option>
            {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        {(dateFrom || dateTo || districtId) && (
          <button onClick={() => { setDateFrom(""); setDateTo(""); setDistrictId(""); }} className="h-10 px-4 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Clear
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5 text-xs text-gray-400 self-center" title="Updates automatically — no refresh needed">
          <Radio size={13} className="text-emerald-500 animate-pulse" />
          <span className="font-medium text-emerald-600">Live</span>
          {lastUpdated && <span>· updated {lastUpdated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
        </div>
      </div>

      {loading && !data ? (
        <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>
      ) : (
        <>
          {/* Row 1: Line + Pie */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Panel title="Calls Over Time" icon={TrendingUp} className="lg:col-span-2">
              {lineData.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={lineData}>
                    <CartesianGrid stroke="#eee" strokeDasharray="5 5" vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: "#6B7280", fontSize: 12 }} />
                    <YAxis tick={{ fill: "#6B7280", fontSize: 12 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="calls" stroke="#164FA3" strokeWidth={3} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Panel>
            <Panel title="Status Breakdown" icon={PieIcon}>
              {pieData.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={pieData} innerRadius={60} outerRadius={100} paddingAngle={3} dataKey="value">
                      {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="bottom" iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </Panel>
          </div>

          {/* Row 2: Bar + Area */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Panel title="Top Agents" icon={BarChart3} className="lg:col-span-2">
              {/* Top Agents' OWN date filter (independent of the shared bar) */}
              <div className="flex flex-wrap items-end gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => { const d = istDate(0); setTaFrom(d); setTaTo(d); }}
                  className={`h-8 px-3 rounded-lg text-xs font-semibold border ${taFrom === istDate(0) && taTo === istDate(0) ? "bg-[#164FA3] text-white border-[#164FA3]" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
                >Today</button>
                <button
                  type="button"
                  onClick={() => { const d = istDate(-1); setTaFrom(d); setTaTo(d); }}
                  className={`h-8 px-3 rounded-lg text-xs font-semibold border ${taFrom === istDate(-1) && taTo === istDate(-1) ? "bg-[#164FA3] text-white border-[#164FA3]" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
                >Yesterday</button>
                <label className="flex flex-col text-[10px] font-semibold uppercase tracking-wide text-gray-400">From
                  <input type="date" value={taFrom} max={taTo || undefined} onChange={(e) => setTaFrom(e.target.value)} className="h-8 px-2 rounded-lg border border-gray-200 text-xs bg-white mt-0.5" />
                </label>
                <label className="flex flex-col text-[10px] font-semibold uppercase tracking-wide text-gray-400">To
                  <input type="date" value={taTo} min={taFrom || undefined} onChange={(e) => setTaTo(e.target.value)} className="h-8 px-2 rounded-lg border border-gray-200 text-xs bg-white mt-0.5" />
                </label>
                {(taFrom || taTo) && (
                  <button type="button" onClick={() => { setTaFrom(""); setTaTo(""); }} className="h-8 px-3 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50">Clear</button>
                )}
                <span className="ml-auto self-center text-[11px] font-medium text-gray-400">
                  {taFrom || taTo ? `${taFrom ? fmtDateLabel(taFrom) : "start"} – ${taTo ? fmtDateLabel(taTo) : "now"}` : "All time"}
                </span>
              </div>
              {taLoading ? (
                <div className="h-[300px] flex items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>
              ) : barData.length === 0 ? (
                <div className="h-[300px] flex items-center justify-center text-gray-400 text-sm">No calls for the selected period.</div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={barData}>
                    <CartesianGrid stroke="#eee" strokeDasharray="5 5" vertical={false} />
                    <XAxis dataKey="agent" tick={{ fill: "#6B7280", fontSize: 12 }} />
                    <YAxis tick={{ fill: "#6B7280", fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="calls" name="Calls" fill="#164FA3" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="connected" name="Connected" fill="#10B981" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Panel>
            <Panel title="Cumulative Connected" icon={Activity}>
              {cumData.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={cumData}>
                    <defs>
                      <linearGradient id="connGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10B981" stopOpacity={0.6} />
                        <stop offset="100%" stopColor="#10B981" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#eee" strokeDasharray="5 5" vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: "#6B7280", fontSize: 12 }} />
                    <YAxis tick={{ fill: "#6B7280", fontSize: 12 }} />
                    <Tooltip />
                    <Area type="monotone" dataKey="cumulative" stroke="#10B981" strokeWidth={2} fill="url(#connGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Panel>
          </div>

          {/* Row 3: Stacked bar — district status mix */}
          <Panel title="District × Status Mix" icon={Layers}>
            {stackedData.length === 0 ? <Empty /> : (
              // All 33 districts always show — scroll horizontally so every bar +
              // its label stays legible instead of being squeezed to fit.
              <div className="overflow-x-auto">
                <div style={{ minWidth: Math.max(700, stackedData.length * 44), height: 350 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stackedData}>
                      <CartesianGrid stroke="#eee" strokeDasharray="5 5" vertical={false} />
                      <XAxis dataKey="district" tick={{ fill: "#6B7280", fontSize: 11 }} angle={-35} textAnchor="end" height={90} interval={0} />
                      <YAxis tick={{ fill: "#6B7280", fontSize: 12 }} allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="Connected" stackId="a" fill="#10B981" />
                      <Bar dataKey="No Answer" stackId="a" fill="#F59E0B" />
                      <Bar dataKey="Wrong Number" stackId="a" fill="#6B7280" />
                      <Bar dataKey="Rejected" stackId="a" fill="#EF4444" />
                      <Bar dataKey="Busy" stackId="a" fill="#8B5CF6" />
                      <Bar dataKey="Switched Off" stackId="a" fill="#0EA5E9" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </Panel>

          {/* Row 5: Activity heat map — actual dates × office hours */}
          <Panel title="Activity Heat Map (calls per hour, 10 AM–7 PM)" icon={Grid3x3}>
            {heatmap.length === 0 ? <Empty /> : (
              <Heatmap data={heatmap} max={heatmapMax} />
            )}
          </Panel>

          {/* Row 6: Workers by Assembly — a horizontal bar chart of the ACTUAL
              worker count per assembly (Assembly → workers), sorted high→low.
              EVERY master assembly (all 90) is shown, including zero-worker ones;
              the scroll container keeps them all accessible. Total below. */}
          <Panel title="Workers by Assembly" icon={Layers}>
            <div className="flex items-center justify-between -mt-3 mb-3 gap-3 flex-wrap">
              <p className="text-xs text-gray-400">Actual workers per assembly (live Contacts count), highest to lowest. All {workersByAssembly.length} assemblies.</p>
              <p className="text-xs font-semibold text-gray-700">Total: <span className="text-[#164FA3]">{Number(workersByAssemblyTotal).toLocaleString("en-IN")}</span></p>
            </div>
            {workersByAssembly.length === 0 ? (
              <div className="h-[120px] flex items-center justify-center text-gray-400 text-sm">No assembly data available.</div>
            ) : (
              <div className="overflow-y-auto" style={{ maxHeight: 520 }}>
                <ResponsiveContainer width="100%" height={Math.max(220, workersByAssembly.length * 24)}>
                  <BarChart layout="vertical" data={workersByAssembly} margin={{ top: 4, right: 48, bottom: 4, left: 8 }} barCategoryGap={4}>
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#9ca3af" }} />
                    <YAxis type="category" dataKey="assembly" width={150} interval={0} tick={{ fontSize: 11, fill: "#374151" }} />
                    <Tooltip cursor={{ fill: "rgba(22,79,163,0.06)" }} content={<WorkersByAssemblyTooltip />} />
                    <Bar dataKey="workers" fill="#164FA3" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
                      <LabelList dataKey="workers" position="right" formatter={(v) => Number(v).toLocaleString("en-IN")} style={{ fontSize: 11, fill: "#374151", fontWeight: 600 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

// Office working hours only (10 AM–7 PM). The heatmap displays just these
// buckets; the underlying data (per-hour call counts keyed by HOUR(called_at)
// in the app timezone) is unchanged — hours outside this range are simply not
// shown. row[h] is the count for hour h, so slicing to these indexes preserves
// the exact bucketing.
const OFFICE_HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
function fmtHour12(h) {
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12} ${ampm}`;
}

// Short IST date label for a heat-map row, e.g. "Mon 18 Aug".
function fmtHeatDay(ymd) {
  const d = new Date(`${ymd}T00:00:00+05:30`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
}

function Heatmap({ data, max }) {
  // Click a cell to pin its exact count below the grid.
  const [sel, setSel] = useState(null); // { day, hour, v }
  const hourRange = (h) => `${fmtHour12(h)}–${fmtHour12((h + 1) % 24)}`;
  return (
    // overflow-x-auto is a safety net only: the grid fills the card width, and
    // min-w keeps cells readable — it scrolls just on very narrow phones.
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid" style={{ gridTemplateColumns: `96px repeat(${OFFICE_HOURS.length}, minmax(0, 1fr))`, gap: 4 }}>
          <div />
          {OFFICE_HOURS.map((h) => (
            <div key={h} className="text-[10px] text-gray-400 text-center font-mono whitespace-nowrap">{fmtHour12(h)}</div>
          ))}
          {data.map((row) => (
            <DayRow key={row.day} row={row} max={max} sel={sel} onSelect={setSel} />
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span>No activity</span>
            <div className="w-3.5 h-3.5 rounded-sm border border-gray-200 bg-white" />
            {[0.2, 0.4, 0.6, 0.8, 1].map((t) => (
              <div key={t} className="w-3.5 h-3.5 rounded-sm" style={{ background: heatColor(t * max, max) }} />
            ))}
            <span>More</span>
          </div>
          <div className="text-xs text-gray-600 min-h-[18px]">
            {sel
              ? <span><strong className="text-gray-900">{fmtHeatDay(sel.day)}</strong>, {hourRange(sel.hour)} → <strong className="text-[#164FA3]">{sel.v}</strong> call{sel.v === 1 ? "" : "s"}</span>
              : <span className="text-gray-400">Click any cell to see its exact call count.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function DayRow({ row, max, sel, onSelect }) {
  const inactive = (row.total || 0) === 0;
  return (
    <>
      <div className="text-xs font-medium pr-2 self-center flex items-center justify-between gap-1">
        <span className="text-gray-600 whitespace-nowrap">{fmtHeatDay(row.day)}</span>
        {inactive && <span className="text-[9px] uppercase tracking-wide text-gray-300 whitespace-nowrap">No activity</span>}
      </div>
      {OFFICE_HOURS.map((h) => {
        const v = row.hours?.[h] || 0;
        const isSel = sel && sel.day === row.day && sel.hour === h;
        // Zero calls → a truly blank cell (white, faint border), never a colored
        // shade — so a quiet hour/day never reads as low activity.
        return (
          <button
            key={h}
            type="button"
            onClick={() => onSelect({ day: row.day, hour: h, v })}
            title={`${fmtHeatDay(row.day)} · ${fmtHour12(h)} — ${v} call${v === 1 ? "" : "s"}`}
            className={`h-8 rounded flex items-center justify-center text-[10px] font-semibold tabular-nums transition-shadow ${v === 0 ? "border border-gray-100 text-transparent" : ""} ${isSel ? "ring-2 ring-[#164FA3] ring-offset-1" : ""}`}
            style={{ background: v === 0 ? "#ffffff" : heatColor(v, max), color: v === 0 ? undefined : (v / max > 0.55 ? "#fff" : "#0B3A82") }}
          >
            {v === 0 ? "" : v}
          </button>
        );
      })}
    </>
  );
}
function heatColor(v, max) {
  // Zero is NEVER shaded — the caller renders 0-cells blank. This only colors
  // cells with >=1 call, scaled to the busiest cell.
  if (max === 0 || v <= 0) return "#ffffff";
  const t = Math.min(1, v / max);
  // Interpolate from light blue to dark blue
  const r = Math.round(219 - (219 - 22)  * t);
  const g = Math.round(234 - (234 - 79)  * t);
  const b = Math.round(254 - (254 - 163) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function Panel({ title, icon: Icon, className = "", children }) {
  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-6 ${className}`}>
      <div className="flex items-center gap-2 mb-4 text-[#164FA3]">
        <Icon size={18} />
        <h2 className="font-bold text-lg">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Empty() {
  return <div className="h-[300px] flex items-center justify-center text-gray-400 text-sm">No data in this range.</div>;
}

// Workers-by-District tooltip — shows ONLY the district name and its actual
// worker count (no required/attempt/strength values).
function WorkersByAssemblyTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-md px-3 py-2 text-xs">
      <div className="font-bold text-gray-900">{d.assembly}</div>
      <div className="text-gray-600 mt-0.5">Actual Workers: <strong className="text-[#164FA3]">{Number(d.workers).toLocaleString("en-IN")}</strong></div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "h-10 px-3 rounded-lg border border-gray-200 text-sm bg-white outline-none focus:ring-2 focus:ring-[#164FA3]";

function fmtDay(d) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

// "YYYY-MM-DD" for today (offset 0), yesterday (-1)… in the app timezone
// (Asia/Kolkata) so the Top Agents quick filters match how calls are dated
// server-side, regardless of the viewer's local timezone.
function istDate(offsetDays = 0) {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  ist.setDate(ist.getDate() + offsetDays);
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, "0");
  const d = String(ist.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
// "01 Aug" style label for a YYYY-MM-DD string (no timezone shift).
function fmtDateLabel(s) {
  if (!s) return "";
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}
