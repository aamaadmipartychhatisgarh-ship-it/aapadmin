"use client";

import { useEffect, useState } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import Avatar from "@/components/Avatar";
import { Trophy, Award, MapPin, Loader2, Medal } from "lucide-react";

export default function Page() {
  return <SupervisorGuard><Body /></SupervisorGuard>;
}

const MEDAL = ["text-[#FCB712]", "text-gray-400", "text-amber-700"];

function Body() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/rankings").then((r) => r.json()).then(setData).finally(() => setLoading(false));
  }, []);
  if (loading || !data) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Rankings & Rewards</h1>
        <p className="text-gray-500 mt-2 font-medium">Top performers, area leaderboards and achievement badges.</p>
      </div>

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
            <ul className="divide-y divide-gray-100">
              {data.areaRankings.map((a, i) => (
                <li key={a.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <span className="flex items-center gap-2">
                    <span className={`font-bold w-5 ${i < 3 ? MEDAL[i] : "text-gray-400"}`}>{i + 1}</span>
                    <span className="font-medium text-gray-800">{a.district_name}</span>
                  </span>
                  <span className="text-gray-500 text-xs">{a.workers} workers · <strong className="text-gray-700">{a.avg_activity}</strong> avg</span>
                </li>
              ))}
            </ul>
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
    </div>
  );
}
