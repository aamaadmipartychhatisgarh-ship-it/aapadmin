"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { Trophy, Award, MapPin, Loader2, Medal } from "lucide-react";

// Rankings & Rewards content (member registrations, area rankings, badges),
// extracted from /dashboard/rankings so it can be reused both there and inside
// the combined Full Ranking tabs — same data source (/api/rankings), no dup.

const MEDAL = ["text-[#FCB712]", "text-gray-400", "text-amber-700"];

export default function RankingsView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/rankings").then((r) => r.json()).then(setData).finally(() => setLoading(false));
  }, []);
  if (loading || !data) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Worker Membership Ranking — callers ranked by members registered. */}
      <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center gap-2">
          <Trophy size={18} className="text-[#FCB712]" />
          <h2 className="font-bold text-gray-900">Top Members Registered</h2>
        </div>
        {data.topWorkers.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">No member registrations yet.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.topWorkers.map((w) => (
              <li key={w.user_id} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50">
                <span className={`w-7 text-center font-bold ${w.rank <= 3 ? MEDAL[w.rank - 1] : "text-gray-400"}`}>
                  {w.rank <= 3 ? <Medal size={18} className="inline" /> : w.rank}
                </span>
                <Avatar name={w.name} size={32} className="bg-[#164FA3]/10" textClassName="text-[#164FA3]" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 truncate">{w.name}</div>
                  <div className="text-xs text-gray-500">Members registered</div>
                </div>
                <span className="text-lg font-bold text-[#164FA3] tabular-nums">{w.members.toLocaleString("en-IN")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Area rankings + badges */}
      <div className="space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-5 border-b border-gray-100 flex items-center gap-2">
            <MapPin size={18} className="text-[#164FA3]" />
            <h2 className="font-bold text-gray-900">Area Rankings</h2>
          </div>
          {data.areaRankings.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">No area data yet.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.areaRankings.map((a, i) => {
                const pct = Number(a.strength_pct) || 0;
                return (
                  <li key={a.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={`font-bold w-5 ${i < 3 ? MEDAL[i] : "text-gray-400"}`}>{i + 1}</span>
                      <span className="font-medium text-gray-800 truncate">{a.district_name}</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="w-20 h-2 bg-gray-100 rounded-full overflow-hidden hidden sm:block"><span className="block h-full bg-[#164FA3] rounded-full" style={{ width: `${Math.min(100, pct)}%` }} /></span>
                      <strong className="text-gray-700 tabular-nums w-14 text-right">{pct}%</strong>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center gap-2 mb-4"><Award size={18} className="text-[#FCB712]" /><h2 className="font-bold text-gray-900">Badges</h2></div>
          <div className="space-y-2">
            {data.badges.map((b) => (
              <div key={b.name} className="flex items-center justify-between">
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold text-white" style={{ background: b.color || "#164FA3" }}>{b.name}</span>
                <span className="text-xs text-gray-500">{b.awarded} awarded</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
