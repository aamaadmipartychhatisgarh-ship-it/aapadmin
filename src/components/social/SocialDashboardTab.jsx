"use client";

import { useEffect, useState } from "react";
import { Loader2, Share2 } from "lucide-react";

const PUBLISH_COLOR = {
  scheduled: "bg-sky-100 text-sky-700",
  published: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

function MetricCard({ label, value, accent, color }) {
  return (
    <div className={`rounded-2xl p-4 shadow-sm ${accent ? "bg-[#164FA3] text-white" : "bg-white border border-gray-100"}`}>
      <div className="flex items-center gap-1.5 mb-2">
        {color && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />}
        <div className={`text-xs font-semibold uppercase tracking-wide ${accent ? "text-blue-200" : "text-gray-400"}`}>{label}</div>
      </div>
      <div className={`text-3xl font-bold ${accent ? "" : "text-gray-900"}`}>{value}</div>
    </div>
  );
}

function TotalsCard({ label, t, accent }) {
  return (
    <div className={`rounded-2xl p-4 shadow-sm ${accent ? "bg-[#164FA3] text-white" : "bg-white border border-gray-100"}`}>
      <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${accent ? "text-blue-200" : "text-gray-400"}`}>{label}</div>
      <div className={`text-2xl font-bold mb-2 ${accent ? "" : "text-gray-900"}`}>{t.pages} page{t.pages === 1 ? "" : "s"}</div>
      <div className={`grid grid-cols-2 gap-x-3 gap-y-1 text-xs ${accent ? "text-blue-100" : "text-gray-500"}`}>
        <span>Posts yesterday: <strong className={accent ? "text-white" : "text-gray-800"}>{t.total_posts}</strong></span>
        <span>Engagement: <strong className={accent ? "text-white" : "text-gray-800"}>{t.engagement.toLocaleString()}</strong></span>
        <span>Scheduled: <strong className={accent ? "text-white" : "text-gray-800"}>{t.scheduled_posts}</strong></span>
        <span>Failed: <strong className={accent ? "text-white" : "text-gray-800"}>{t.failed_posts}</strong></span>
      </div>
    </div>
  );
}

// Yesterday's per-page statistics — Total/Scheduled/Published/Failed posts +
// engagement, grouped into Facebook/Instagram/Combined totals. Fetches
// GET /api/social-management/dashboard (a dedicated endpoint separate from
// the main aggregate route, so it can compute yesterday-scoped per-page
// numbers without disturbing that route's existing shape).
// Local YYYY-MM-DD for "today" (no Date-arg needed at module load).
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function SocialDashboardTab({ PLATFORM }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Selected day for the Page-wise Daily Post Status (BUG 5). Defaults to today;
  // changing it re-fetches the day's per-page counts from the DB.
  const [date, setDate] = useState(todayKey());

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/social-management/dashboard?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setData(d); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [date]);

  if (loading && !data) return <div className="flex h-48 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  if (!data) return <div className="p-8 text-center text-gray-400">Couldn't load the dashboard.</div>;

  const h = data.headline || { total_posts: 0, scheduled_posts: 0, followers: { facebook: 0, instagram: 0, twitter: 0 } };
  const nfmt = (n) => Number(n || 0).toLocaleString("en-IN");
  // The 5 headline cards (BUG 4) — always shown, straight from the DB.
  const HeadlineCards = () => (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      <MetricCard label="Total Posts" value={nfmt(h.total_posts)} accent />
      <MetricCard label="Total Scheduled Posts" value={nfmt(h.scheduled_posts)} />
      <MetricCard label="Instagram Followers" value={nfmt(h.followers.instagram)} color="#E4405F" />
      <MetricCard label="Facebook Followers" value={nfmt(h.followers.facebook)} color="#1877F2" />
      <MetricCard label="Twitter/X Followers" value={nfmt(h.followers.twitter)} color="#000000" />
    </div>
  );

  if (data.pages.length === 0) {
    return (
      <div className="space-y-6">
        <HeadlineCards />
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-400">
          <Share2 size={36} className="mx-auto text-gray-300 mb-3" />
          No pages yet — add your first page in the Pages tab, then the daily post status will show up here automatically.
        </div>
      </div>
    );
  }

  const DAILY_PLATFORMS = ["facebook", "instagram", "twitter"];

  return (
    <div className="space-y-6">
      <HeadlineCards />

      {/* Page-wise Daily Post Status (BUG 5) — every page from the master, grouped
          by platform, for the selected day. Green = ≥1 published post; Red = none. */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Page-wise Daily Post Status</h2>
            <p className="text-sm text-gray-500">Per page, for the selected day. <span className="text-emerald-600 font-medium">Done</span> = at least one published post; <span className="text-red-600 font-medium">Not done</span> = none.</p>
          </div>
          <label className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]/30" />
            {loading && <Loader2 size={14} className="animate-spin text-[#164FA3]" />}
          </label>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {DAILY_PLATFORMS.map((key) => {
            const meta = PLATFORM[key] || {};
            const Icon = meta.icon || Share2;
            const list = data.pages.filter((p) => p.platform === key);
            return (
              <div key={key} className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100">
                  <span className="w-6 h-6 rounded-md flex items-center justify-center text-white shrink-0" style={{ background: meta.color || "#999" }}><Icon size={13} /></span>
                  <span className="font-semibold text-gray-800 text-sm">{meta.label || key}</span>
                  <span className="text-xs text-gray-400">({list.length})</span>
                </div>
                {list.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-gray-400">No {meta.label || key} pages.</div>
                ) : (
                  <ul className="divide-y divide-gray-50">
                    {list.map((p) => (
                      <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <span className="flex-1 min-w-0 truncate font-medium text-gray-800" title={p.handle}>{p.handle}</span>
                        <span className="text-xs text-gray-500 shrink-0 tabular-nums">{p.total_posts} Post{p.total_posts === 1 ? "" : "s"}</span>
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0 ${p.done ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{p.done ? "Done" : "Not done"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-bold text-gray-900">Daily Statistics</h2>
        <p className="text-sm text-gray-500">Per-page totals for the selected day — auto-calculated from the post log.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <TotalsCard label="Facebook" t={data.totals.facebook} />
        <TotalsCard label="Instagram" t={data.totals.instagram} />
        <TotalsCard label="Combined Total" t={data.totals.combined} accent />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.pages.map((p) => {
          const meta = PLATFORM[p.platform] || {};
          const Icon = meta.icon || Share2;
          return (
            <div key={p.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: meta.color || "#999" }}><Icon size={16} /></div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-gray-900 text-sm truncate">{p.lok_sabha_name || "—"}</div>
                  <div className="text-xs text-gray-500 truncate">{p.handle}</div>
                </div>
                <span className="text-xl font-bold text-gray-900">{p.total_posts}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${PUBLISH_COLOR.scheduled}`}>{p.scheduled_posts} scheduled</span>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${PUBLISH_COLOR.published}`}>{p.published_posts} published</span>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${PUBLISH_COLOR.failed}`}>{p.failed_posts} failed</span>
              </div>
              <div className="text-xs text-gray-500 pt-2 border-t border-gray-100">Engagement: <strong className="text-gray-800">{p.engagement.toLocaleString()}</strong></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
