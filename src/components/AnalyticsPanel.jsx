"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  Treemap,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
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

  const treemapData = useMemo(() => {
    const rows = data?.treemap || [];
    // Group districts under zones
    const zoneMap = {};
    rows.forEach((r) => {
      const z = r.zone || "Unzoned";
      if (!zoneMap[z]) zoneMap[z] = { name: z, children: [] };
      zoneMap[z].children.push({ name: r.district, size: Number(r.n) });
    });
    return Object.values(zoneMap);
  }, [data]);

  const heatmap = data?.heatmap || [];
  const heatmapMax = useMemo(() => {
    let m = 0;
    heatmap.forEach((row) => row.forEach((v) => { if (v > m) m = v; }));
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
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={stackedData}>
                  <CartesianGrid stroke="#eee" strokeDasharray="5 5" vertical={false} />
                  <XAxis dataKey="district" tick={{ fill: "#6B7280", fontSize: 11 }} angle={-15} textAnchor="end" height={70} interval={0} />
                  <YAxis tick={{ fill: "#6B7280", fontSize: 12 }} />
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
            )}
          </Panel>

          {/* Row 5: Heatmap (custom CSS grid) */}
          <Panel title="Activity Heatmap (10 AM–7 PM × day of week)" icon={Grid3x3}>
            {heatmapMax === 0 ? <Empty /> : (
              <Heatmap data={heatmap} max={heatmapMax} />
            )}
          </Panel>

          {/* Row 6: Treemap */}
          <Panel title="Calls by District (treemap)" icon={Layers}>
            {treemapData.length === 0 ? <Empty /> : (
              <ResponsiveContainer width="100%" height={400}>
                <Treemap
                  data={treemapData}
                  dataKey="size"
                  nameKey="name"
                  stroke="#fff"
                  content={<TreemapNode />}
                />
              </ResponsiveContainer>
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

function Heatmap({ data, max }) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div className="grid" style={{ gridTemplateColumns: `48px repeat(${OFFICE_HOURS.length}, minmax(34px, 1fr))`, gap: 2 }}>
          <div />
          {OFFICE_HOURS.map((h) => (
            <div key={h} className="text-[10px] text-gray-400 text-center font-mono whitespace-nowrap">{fmtHour12(h)}</div>
          ))}
          {data.map((row, d) => (
            <DayRow key={d} day={days[d]} row={row} max={max} />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
          <span>Less</span>
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => (
            <div key={t} className="w-4 h-4 rounded" style={{ background: heatColor(t * max, max) }} />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
function DayRow({ day, row, max }) {
  return (
    <>
      <div className="text-xs text-gray-500 font-medium pr-2 self-center">{day}</div>
      {OFFICE_HOURS.map((h) => {
        const v = row[h] || 0;
        return (
          <div
            key={h}
            title={`${day} ${h}:00 — ${v} call${v === 1 ? "" : "s"}`}
            className="aspect-square rounded"
            style={{ background: heatColor(v, max) }}
          />
        );
      })}
    </>
  );
}
function heatColor(v, max) {
  if (max === 0 || v === 0) return "#f3f4f6";
  const t = Math.min(1, v / max);
  // Interpolate from light blue to dark blue
  const r = Math.round(219 - (219 - 22)  * t);
  const g = Math.round(234 - (234 - 79)  * t);
  const b = Math.round(254 - (254 - 163) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function TreemapNode(props) {
  const { x, y, width, height, name, depth, root } = props;
  if (depth === 0) return null;
  // Top-level: zones (parents). Color by zone name. Children inherit a tint.
  const zoneName = depth === 1 ? name : root?.children?.find((z) => z.children?.some((c) => c.name === name))?.name;
  const color = ZONE_COLORS[zoneName] || "#9CA3AF";
  const opacity = depth === 1 ? 0.85 : 0.65;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={color} fillOpacity={opacity} stroke="#fff" />
      {width > 60 && height > 30 && (
        <text x={x + 6} y={y + 16} fill="#fff" fontSize="11" fontWeight="600">{name}</text>
      )}
      {depth === 2 && width > 60 && height > 50 && (
        <text x={x + 6} y={y + 32} fill="#fff" fontSize="10" opacity={0.85}>{props.size}</text>
      )}
    </g>
  );
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
