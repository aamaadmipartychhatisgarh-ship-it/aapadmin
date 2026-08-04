"use client";

import { useEffect, useState } from "react";
import { Loader2, Share2 } from "lucide-react";

const PUBLISH_COLOR = {
  scheduled: "bg-sky-100 text-sky-700",
  published: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

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
export default function SocialDashboardTab({ PLATFORM }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/social-management/dashboard").then((r) => (r.ok ? r.json() : null)).then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex h-48 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  if (!data) return <div className="p-8 text-center text-gray-400">Couldn't load the dashboard.</div>;

  if (data.pages.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-400">
        <Share2 size={36} className="mx-auto text-gray-300 mb-3" />
        No pages yet — add your first page in the Pages tab, then yesterday's stats will show up here automatically.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Yesterday's Statistics</h2>
        <p className="text-sm text-gray-500">Auto-calculated per page from the post log — no manual counting.</p>
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
