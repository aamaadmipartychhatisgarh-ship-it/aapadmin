"use client";

import { useEffect, useState } from "react";
import { Newspaper, Mic, Tv, FileText, Clock, TrendingUp, TrendingDown, Minus, Loader2 } from "lucide-react";

// Yesterday's Performance — six KPI cards, each with Yesterday/Weekly/
// Monthly counts and a trend arrow, sourced from GET /api/media/dashboard
// (a dedicated endpoint, not the oversight-only Reports Engine, so
// press_media staff can see it too — see that route's comment). Clicking a
// card opens the matching Reports Center module for the full detail.
const CARDS = [
  { key: "newspapersPublished", label: "Newspapers Published", icon: Newspaper, color: "bg-blue-50 text-[#164FA3]", module: "press_notes" },
  { key: "pressConferences", label: "Press Conferences Held", icon: Mic, color: "bg-violet-50 text-violet-600", module: "press_conferences" },
  { key: "tvDebates", label: "TV News Debates", icon: Tv, color: "bg-amber-50 text-amber-600", module: "debates" },
  { key: "mediaCoverageTotal", label: "Media Coverage Total", icon: TrendingUp, color: "bg-emerald-50 text-emerald-600", module: "press_notes" },
  { key: "pressNotesReleased", label: "Press Notes Released", icon: FileText, color: "bg-sky-50 text-sky-600", module: "press_notes" },
];

function trend(current, previous) {
  if (previous === 0 && current === 0) return { dir: "flat", pct: 0 };
  if (previous === 0) return { dir: "up", pct: 100 };
  const pct = Math.round(((current - previous) / previous) * 100);
  return { dir: pct > 0 ? "up" : pct < 0 ? "down" : "flat", pct: Math.abs(pct) };
}

function TrendBadge({ current, previous }) {
  const t = trend(current, previous);
  const Icon = t.dir === "up" ? TrendingUp : t.dir === "down" ? TrendingDown : Minus;
  const color = t.dir === "up" ? "text-emerald-600" : t.dir === "down" ? "text-red-500" : "text-gray-400";
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${color}`}>
      <Icon size={12} /> {t.dir === "flat" ? "no change" : `${t.pct}%`}
    </span>
  );
}

export default function MediaDashboardTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/media/dashboard").then((r) => (r.ok ? r.json() : null)).then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex h-48 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  if (!data) return <div className="p-8 text-center text-gray-400">Couldn't load the dashboard.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Yesterday's Performance</h2>
        <p className="text-sm text-gray-500">Auto-calculated from Media Center records — no manual counting.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {CARDS.map((c) => {
          const d = data[c.key];
          const Icon = c.icon;
          return (
            <a
              key={c.key}
              href={`/dashboard/reports?module=${c.module}`}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-9 h-9 rounded-xl ${c.color} flex items-center justify-center shrink-0`}><Icon size={18} /></div>
                <span className="font-semibold text-gray-800 text-sm flex-1">{c.label}</span>
              </div>
              <div className="flex items-end gap-2 mb-1">
                <span className="text-3xl font-bold text-gray-900">{d.yesterday.toLocaleString()}</span>
                <span className="text-xs text-gray-400 mb-1">yesterday</span>
                <span className="ml-auto"><TrendBadge current={d.yesterday} previous={d.day_before} /></span>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500 pt-2 border-t border-gray-100 mt-2">
                <span>This week: <span className="font-semibold text-gray-700">{d.this_week.toLocaleString()}</span> <TrendBadge current={d.this_week} previous={d.last_week} /></span>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span>This month: <span className="font-semibold text-gray-700">{d.this_month.toLocaleString()}</span> <TrendBadge current={d.this_month} previous={d.last_month} /></span>
              </div>
            </a>
          );
        })}

        {/* Pending Media Activities — forward-looking, no historical trend */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-xl bg-red-50 text-red-600 flex items-center justify-center shrink-0"><Clock size={18} /></div>
            <span className="font-semibold text-gray-800 text-sm flex-1">Pending Media Activities</span>
          </div>
          <div className="flex items-end gap-2 mb-1">
            <span className="text-3xl font-bold text-gray-900">{data.pendingActivities.due_today.toLocaleString()}</span>
            <span className="text-xs text-gray-400 mb-1">due today</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-500 pt-2 border-t border-gray-100 mt-2">
            <span>Due this week: <span className="font-semibold text-gray-700">{data.pendingActivities.due_week.toLocaleString()}</span></span>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span>Due this month: <span className="font-semibold text-gray-700">{data.pendingActivities.due_month.toLocaleString()}</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}
