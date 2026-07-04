"use client";

import { useEffect, useState, useMemo } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import { canAccessSocial } from "@/lib/permissions";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Loader2, Eye, Users, TrendingUp, Flame, ThumbsUp, Camera, MessageCircle } from "lucide-react";

const PLATFORM = {
  facebook: { label: "Facebook", icon: ThumbsUp, color: "#1877F2" },
  instagram: { label: "Instagram", icon: Camera, color: "#E4405F" },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, color: "#25D366" },
};

export default function Page() {
  return <SupervisorGuard allow={canAccessSocial}><Body /></SupervisorGuard>;
}

function fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n ?? 0);
}

function Body() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { fetch("/api/social").then((r) => r.json()).then(setData).finally(() => setLoading(false)); }, []);

  const trendData = useMemo(() => {
    if (!data?.trend) return [];
    const byDate = {};
    data.trend.forEach((r) => {
      const d = r.metric_date.slice(0, 10);
      byDate[d] = byDate[d] || { date: d.slice(5) };
      byDate[d][r.platform] = r.reach;
    });
    return Object.values(byDate);
  }, [data]);

  if (loading || !data) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  const t = data.totals || {};

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Social Media War Room</h1>
        <p className="text-gray-500 mt-2 font-medium">Cross-platform reach & engagement monitoring. <span className="text-amber-600">(demo data)</span></p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={Users} label="Total Followers" value={fmt(t.followers)} accent />
        <Kpi icon={Eye} label="Daily Views" value={fmt(t.views)} />
        <Kpi icon={TrendingUp} label="Daily Reach" value={fmt(t.reach)} />
        <Kpi icon={Flame} label="Viral Posts" value={t.viral || 0} />
      </div>

      {/* Per-platform cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {data.latest.map((p) => {
          const meta = PLATFORM[p.platform];
          const Icon = meta.icon;
          return (
            <div key={p.platform} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white" style={{ background: meta.color }}><Icon size={18} /></div>
                <h3 className="font-bold text-gray-900">{meta.label}</h3>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Metric label="Followers" value={fmt(p.followers)} />
                <Metric label="Views" value={fmt(p.views)} />
                <Metric label="Reach" value={fmt(p.reach)} />
                <Metric label="Engagement" value={fmt(p.engagement)} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Reach trend */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-bold text-lg text-gray-900 mb-6">Reach Trend (30 days)</h2>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData}>
              <CartesianGrid stroke="#eee" strokeDasharray="5 5" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "#6B7280", fontSize: 11 }} interval={4} />
              <YAxis tick={{ fill: "#6B7280", fontSize: 11 }} tickFormatter={fmt} />
              <Tooltip formatter={(v) => fmt(v)} />
              <Legend />
              <Line type="monotone" dataKey="facebook" stroke={PLATFORM.facebook.color} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="instagram" stroke={PLATFORM.instagram.color} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="whatsapp" stroke={PLATFORM.whatsapp.color} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, accent }) {
  return (
    <div className={`${accent ? "bg-[#164FA3] text-white" : "bg-white border border-gray-100"} rounded-2xl p-5 shadow-sm`}>
      <div className={`w-9 h-9 rounded-full flex items-center justify-center mb-3 ${accent ? "bg-white/20" : "bg-gray-100 text-[#164FA3]"}`}><Icon size={18} /></div>
      <div className={`text-2xl font-bold ${accent ? "" : "text-gray-900"}`}>{value}</div>
      <div className={`text-xs font-medium mt-1 ${accent ? "text-blue-200" : "text-gray-500"}`}>{label}</div>
    </div>
  );
}
function Metric({ label, value }) {
  return <div><div className="text-gray-400 text-xs">{label}</div><div className="font-bold text-gray-900">{value}</div></div>;
}
