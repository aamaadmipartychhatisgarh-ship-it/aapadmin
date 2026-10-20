"use client";

import { useEffect, useState } from "react";
import { Loader2, Share2 } from "lucide-react";

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

// Social Media Dashboard — the headline cards (total / scheduled posts and the
// per-platform follower totals), straight from GET /api/social-management/dashboard.
// The Page-wise Daily Post Status and Daily Statistics sections were removed.
export default function SocialDashboardTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/social-management/dashboard")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setData(d); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading && !data) return <div className="flex h-48 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  if (!data) return <div className="p-8 text-center text-gray-400">Couldn't load the dashboard.</div>;

  const h = data.headline || { total_posts: 0, scheduled_posts: 0, followers: { facebook: 0, instagram: 0, twitter: 0 } };
  const nfmt = (n) => Number(n || 0).toLocaleString("en-IN");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <MetricCard label="Total Posts" value={nfmt(h.total_posts)} accent />
        <MetricCard label="Total Scheduled Posts" value={nfmt(h.scheduled_posts)} />
        <MetricCard label="Instagram Followers" value={nfmt(h.followers.instagram)} color="#E4405F" />
        <MetricCard label="Facebook Followers" value={nfmt(h.followers.facebook)} color="#1877F2" />
        <MetricCard label="Twitter/X Followers" value={nfmt(h.followers.twitter)} color="#000000" />
      </div>
      {(data.pages || []).length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-400">
          <Share2 size={36} className="mx-auto text-gray-300 mb-3" />
          No pages yet — add your first page in the Pages tab.
        </div>
      )}
    </div>
  );
}
