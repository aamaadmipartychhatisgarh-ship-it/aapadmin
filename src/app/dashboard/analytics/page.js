"use client";

import { useEffect, useState, useMemo } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Treemap, FunnelChart, Funnel, LabelList,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Loader2, Filter, BarChart3, PieChart as PieIcon, TrendingUp, Layers, Activity, Calendar, Radar as RadarIcon, GitBranch, Grid3x3 } from "lucide-react";

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
const RADAR_COLORS = ["#164FA3", "#FCB712", "#10B981", "#EF4444", "#8B5CF6"];

export default function Page() {
  return <SupervisorGuard><Body /></SupervisorGuard>;
}

function Body() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [districts, setDistricts] = useState([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [districtId, setDistrictId] = useState("");

  useEffect(() => {
    fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || []));
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (dateFrom)   params.set("date_from", dateFrom);
    if (dateTo)     params.set("date_to", dateTo);
    if (districtId) params.set("district_id", districtId);
    fetch(`/api/analytics?${params}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, districtId]);

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

  const barData = useMemo(() =>
    (data?.topAgents || []).map((r) => ({ agent: r.agent, calls: Number(r.calls), connected: Number(r.connected) })),
  [data]);

  // Radar — normalize each metric to 0-100 so all axes share one scale
  const radarData = useMemo(() => {
    const agents = data?.radarAgents || [];
    if (agents.length === 0) return { data: [], series: [] };
    const max = {
      total:        Math.max(1, ...agents.map((a) => Number(a.total))),
      connected:    Math.max(1, ...agents.map((a) => Number(a.connected))),
      avg_duration: Math.max(1, ...agents.map((a) => Number(a.avg_duration))),
      interested:   Math.max(1, ...agents.map((a) => Number(a.interested))),
      follow_ups:   Math.max(1, ...agents.map((a) => Number(a.follow_ups))),
    };
    const axes = ["Total", "Connected", "Avg duration", "Interested", "Follow-ups"];
    const rows = axes.map((axis) => {
      const row = { axis };
      agents.forEach((a) => {
        const v = axis === "Total" ? a.total
                : axis === "Connected" ? a.connected
                : axis === "Avg duration" ? a.avg_duration
                : axis === "Interested" ? a.interested
                : a.follow_ups;
        const key = axis === "Total" ? "total"
                  : axis === "Connected" ? "connected"
                  : axis === "Avg duration" ? "avg_duration"
                  : axis === "Interested" ? "interested"
                  : "follow_ups";
        row[a.agent] = Math.round((Number(v) / max[key]) * 100);
      });
      return row;
    });
    return { data: rows, series: agents.map((a) => a.agent) };
  }, [data]);

  const funnelData = useMemo(() => {
    if (!data?.funnel) return [];
    return [
      { name: "Loaded",    value: Number(data.funnel.loaded || 0),    fill: "#164FA3" },
      { name: "Assigned",  value: Number(data.funnel.assigned || 0),  fill: "#3B82F6" },
      { name: "Attempted", value: Number(data.funnel.attempted || 0), fill: "#F59E0B" },
      { name: "Completed", value: Number(data.funnel.completed || 0), fill: "#10B981" },
    ];
  }, [data]);

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
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end flex-wrap gap-4">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Analytics</h1>
          <p className="text-gray-500 mt-2 font-medium">Visualize calling activity across every dimension.</p>
        </div>
      </div>

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
              {barData.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={barData}>
                    <CartesianGrid stroke="#eee" strokeDasharray="5 5" vertical={false} />
                    <XAxis dataKey="agent" tick={{ fill: "#6B7280", fontSize: 12 }} />
                    <YAxis tick={{ fill: "#6B7280", fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="calls" fill="#164FA3" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="connected" fill="#10B981" radius={[6, 6, 0, 0]} />
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

          {/* Row 4: Radar + Funnel */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Panel title="Top-5 Agent Profile (normalized)" icon={RadarIcon}>
              {radarData.data.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={350}>
                  <RadarChart data={radarData.data}>
                    <PolarGrid stroke="#e5e7eb" />
                    <PolarAngleAxis dataKey="axis" tick={{ fill: "#6B7280", fontSize: 11 }} />
                    <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: "#9CA3AF", fontSize: 10 }} />
                    <Tooltip />
                    <Legend />
                    {radarData.series.map((agent, i) => (
                      <Radar
                        key={agent}
                        name={agent}
                        dataKey={agent}
                        stroke={RADAR_COLORS[i % RADAR_COLORS.length]}
                        fill={RADAR_COLORS[i % RADAR_COLORS.length]}
                        fillOpacity={0.15}
                      />
                    ))}
                  </RadarChart>
                </ResponsiveContainer>
              )}
            </Panel>
            <Panel title="Contact Pipeline Funnel" icon={GitBranch}>
              {funnelData.every((d) => d.value === 0) ? <Empty /> : (
                <ResponsiveContainer width="100%" height={350}>
                  <FunnelChart>
                    <Tooltip />
                    <Funnel dataKey="value" data={funnelData} isAnimationActive>
                      <LabelList position="right" fill="#111827" stroke="none" dataKey="name" />
                      <LabelList position="left" fill="#fff" stroke="none" dataKey="value" />
                    </Funnel>
                  </FunnelChart>
                </ResponsiveContainer>
              )}
            </Panel>
          </div>

          {/* Row 5: Heatmap (custom CSS grid) */}
          <Panel title="Activity Heatmap (hour × day of week)" icon={Grid3x3}>
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

function Heatmap({ data, max }) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div className="grid" style={{ gridTemplateColumns: `48px repeat(24, minmax(22px, 1fr))`, gap: 2 }}>
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-[10px] text-gray-400 text-center font-mono">{h}</div>
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
      {row.map((v, h) => (
        <div
          key={h}
          title={`${day} ${h}:00 — ${v} call${v === 1 ? "" : "s"}`}
          className="aspect-square rounded"
          style={{ background: heatColor(v, max) }}
        />
      ))}
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
