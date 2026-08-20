"use client";

import { useEffect, useState, useCallback } from "react";
import { Newspaper, Mic, Tv, TrendingUp, TrendingDown, Minus, Loader2, Calendar, CheckCircle2 } from "lucide-react";
import Avatar from "@/components/Avatar";

// Yesterday's Performance — six KPI cards, each with Yesterday/Weekly/
// Monthly counts and a trend arrow, sourced from GET /api/media/dashboard
// (a dedicated endpoint, not the oversight-only Reports Engine, so
// press_media staff can see it too — see that route's comment).
//
// Clicking a card drills into the RELEVANT Media Center tab (its own section),
// NOT the Reports page — Reports opens only from the Reports menu. `tab` is the
// Media Center tab key to switch to (see the parent's TABS).
const CARDS = [
  { key: "newspapersPublished", label: "Newspapers Published", icon: Newspaper, color: "bg-blue-50 text-[#164FA3]", tab: "newspapers" },
  { key: "pressConferences", label: "Press Conferences Held", icon: Mic, color: "bg-violet-50 text-violet-600", tab: "conferences" },
  { key: "tvDebates", label: "TV News Debates", icon: Tv, color: "bg-amber-50 text-amber-600", tab: "channels" },
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

export default function MediaDashboardTab({ onOpenTab }) {
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
            <button
              key={c.key}
              type="button"
              onClick={() => onOpenTab?.(c.tab)}
              title={`View ${c.label} in Media Center`}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-left w-full hover:shadow-md hover:border-[#164FA3]/30 transition-shadow"
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
            </button>
          );
        })}
      </div>

      <DayReport />
    </div>
  );
}

// Daily report — defaults to YESTERDAY (the date is resolved server-side in the
// app's timezone and echoed back, so the client never has to guess). One fetch
// drives all three sections, so changing the date updates Newspaper, Press
// Conference and News Channels together — they can never drift apart.
function fmtReportDate(ymd) {
  if (!ymd) return "";
  const d = new Date(`${ymd}T00:00:00`);
  if (isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

function DayReport() {
  const [date, setDate] = useState("");   // selected report date (YYYY-MM-DD)
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback((d) => {
    setLoading(true);
    const qs = d ? `?date=${d}` : "";
    fetch(`/api/media/dashboard/day${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => { setData(res); if (res?.date) setDate(res.date); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]); // initial load → yesterday (server default)

  const onPick = (e) => { const d = e.target.value; if (d) { setDate(d); load(d); } };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Daily Report</h2>
          <p className="text-sm text-gray-500">Actual records for {date ? fmtReportDate(date) : "the selected day"}. Defaults to yesterday.</p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 inline-flex items-center gap-1"><Calendar size={13} /> Report Date</span>
          <input type="date" value={date} onChange={onPick} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
        </label>
      </div>

      {loading && !data ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>
      ) : (
        <div className={`grid grid-cols-1 lg:grid-cols-3 gap-4 ${loading ? "opacity-60" : ""}`}>
          {/* Section 1 — Newspaper */}
          <ReportCard icon={Newspaper} title="Newspaper" count={data?.newspapers?.length || 0}>
            {(data?.newspapers || []).length === 0 ? (
              <EmptyRow />
            ) : data.newspapers.map((n) => (
              <div key={n.id} className="py-2 border-b border-gray-50 last:border-0">
                <div className="text-sm font-semibold text-gray-900">{n.title}</div>
                {n.summary && <div className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap break-words">{n.summary}</div>}
                <div className="text-[11px] font-medium text-[#164FA3] mt-1">{n.newspaper_name || "—"}</div>
              </div>
            ))}
          </ReportCard>

          {/* Section 2 — Press Conference */}
          <ReportCard icon={Mic} title="Press Conference" count={data?.conferences?.length || 0}>
            {(data?.conferences || []).length === 0 ? (
              <EmptyRow />
            ) : data.conferences.map((c) => (
              <div key={c.id} className="py-2 border-b border-gray-50 last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-gray-900 truncate">{c.title}</div>
                  <span className={`shrink-0 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${c.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                    {c.status === "completed" ? <><CheckCircle2 size={11} /> Done</> : c.status}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  {c.spokesperson_name ? <><Avatar name={c.spokesperson_name} src={c.spokesperson_photo} size={20} /><span className="text-xs text-gray-600">{c.spokesperson_name}</span></> : <span className="text-xs text-gray-400">No spokesperson</span>}
                </div>
              </div>
            ))}
          </ReportCard>

          {/* Section 3 — News Channels */}
          <ReportCard icon={Tv} title="News Channels" count={data?.debates?.length || 0}>
            {(data?.debates || []).length === 0 ? (
              <EmptyRow />
            ) : data.debates.map((d) => (
              <div key={d.id} className="py-2 border-b border-gray-50 last:border-0">
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#164FA3]">{d.channel_name || "—"}</div>
                <div className="text-sm font-semibold text-gray-900">{d.topic}</div>
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  {(d.spokespersons || []).length === 0 ? <span className="text-xs text-gray-400">No spokesperson</span> : d.spokespersons.map((s, i) => (
                    <span key={i} className="inline-flex items-center gap-1"><Avatar name={s.name} src={s.photo_url} size={18} /><span className="text-xs text-gray-600">{s.name}</span></span>
                  ))}
                </div>
              </div>
            ))}
          </ReportCard>
        </div>
      )}
    </div>
  );
}

function ReportCard({ icon: Icon, title, count, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-100">
        <Icon size={16} className="text-[#164FA3]" />
        <span className="font-bold text-gray-900 text-sm">{title}</span>
        <span className="ml-auto text-[11px] font-semibold text-gray-400">{count}</span>
      </div>
      <div className="max-h-80 overflow-auto">{children}</div>
    </div>
  );
}

function EmptyRow() {
  return <div className="py-6 text-center text-xs text-gray-400">No activity found for this date</div>;
}
