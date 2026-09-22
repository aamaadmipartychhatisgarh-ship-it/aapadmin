"use client";

import { useEffect, useState } from "react";
import { Loader2, MapPin, Trophy, Building2, Users } from "lucide-react";
import Avatar from "@/components/Avatar";

// Assembly-wise "Area Ranking": ALL assemblies (from the locations master) ranked by
// their live worker/contact count, from /api/rankings/assemblies. Assemblies with
// zero workers still appear. Each row also shows the assembly's CURRENT MEMBER (MLA)
// — name + existing photo — resolved server-side from the Leader Assessment
// relationship by id; assemblies without one show "Not Assigned" and stay visible.
// Responsive — the table scrolls horizontally on small screens so nothing is cut off.
export default function AssemblyRankingView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    fetch("/api/rankings/assemblies", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setError("Could not load the assembly ranking."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="flex h-40 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  if (error) return <div className="rounded-2xl border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3">{error}</div>;

  const rows = data?.assemblies || [];
  const totals = data?.totals || {};

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat icon={Building2} label="Assemblies" value={Number(totals.assemblies || 0).toLocaleString("en-IN")} />
        <Stat icon={Users} label="Total Workers" value={Number(totals.workers || 0).toLocaleString("en-IN")} tone="blue" />
        <Stat icon={Trophy} label="Top Assembly" value={totals.top?.assembly_name || "—"} sub={totals.top ? `${Number(totals.top.workers).toLocaleString("en-IN")} workers` : "No data yet"} tone="amber" />
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          <MapPin size={16} className="text-[#164FA3]" />
          <h3 className="text-sm font-bold text-gray-900">Assembly-wise Ranking</h3>
          <span className="ml-auto text-xs text-gray-400">Ranked by workers · state-wide</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-2.5 w-16">Rank</th>
                <th className="px-4 py-2.5">Assembly</th>
                <th className="px-4 py-2.5">Current Member</th>
                <th className="px-4 py-2.5">District</th>
                <th className="px-4 py-2.5 text-right">Workers</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">No assemblies found.</td></tr>
              ) : rows.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${a.rank <= 3 && a.workers > 0 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{a.rank}</span>
                  </td>
                  <td className="px-4 py-2.5 font-semibold text-gray-900">{a.assembly_name || "—"}</td>
                  <td className="px-4 py-2.5">
                    {a.current_member_name ? (
                      <span className="flex items-center gap-2 min-w-0">
                        <Avatar name={a.current_member_name} src={a.current_member_photo} size={28} className="bg-[#164FA3]/10" textClassName="text-[#164FA3]" />
                        <span className="font-medium text-gray-800 truncate">{a.current_member_name}</span>
                      </span>
                    ) : (
                      <span className="text-gray-400 italic">Not Assigned</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{a.district_name || "—"}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-gray-900">{Number(a.workers).toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, tone }) {
  const toneCls = tone === "blue" ? "bg-blue-50 text-blue-700" : tone === "amber" ? "bg-amber-50 text-amber-700" : "bg-gray-50 text-gray-600";
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-3">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${toneCls}`}><Icon size={20} /></div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="font-bold text-gray-900 truncate">{value}</p>
        {sub ? <p className="text-xs text-gray-500 truncate">{sub}</p> : null}
      </div>
    </div>
  );
}
