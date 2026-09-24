"use client";

import { useEffect, useMemo, useState } from "react";
import { Layers, Star, Loader2 } from "lucide-react";
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

function AssemblyBarChart({ title, icon: Icon, rows, dataKey, unitLabel, color }) {
  const data = useMemo(() => rows.map((r) => ({ assembly: r.assembly, value: Number(r[dataKey]) || 0 })), [rows, dataKey]);
  const total = useMemo(() => data.reduce((s, r) => s + r.value, 0), [data]);
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}14`, color }}><Icon size={16} /></span>
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
      </div>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <p className="text-xs text-gray-400">Live count per assembly, highest to lowest. All {data.length} assemblies.</p>
        <p className="text-xs font-semibold text-gray-700">Total: <span style={{ color }}>{Number(total).toLocaleString("en-IN")}</span></p>
      </div>
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
          <AssemblyBarChart title="Worker by Assembly" icon={Layers} rows={data?.workers || []} dataKey="workers" unitLabel="Workers" color="#164FA3" />
          <AssemblyBarChart title="Influencer by Assembly" icon={Star} rows={data?.influencers || []} dataKey="influencers" unitLabel="Influencers" color="#22a45d" />
        </div>
      )}
    </div>
  );
}
