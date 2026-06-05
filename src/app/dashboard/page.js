"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { PhoneCall, PhoneForwarded, TrendingUp, Trophy, Heart, ArrowRight, Loader2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { isAdmin, isSupervisorRole } from "@/lib/permissions";

export default function UserDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (status === "authenticated" && isAdmin(session)) {
      router.push("/dashboard/admin");
    } else if (status === "authenticated" && isSupervisorRole(session)) {
      router.push("/dashboard/supervisor");
    } else if (status === "authenticated") {
      fetch("/api/me/stats").then((r) => r.json()).then((d) => setStats(d)).finally(() => setLoading(false));
    }
  }, [status, session, router]);

  if (status === "loading" || !session || isAdmin(session) || isSupervisorRole(session)) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  if (loading || !stats) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  const { today, week, sentiment, rank } = stats;
  const sentimentTotal = Object.values(sentiment).reduce((a, b) => a + b, 0);
  const supporterRate = sentimentTotal > 0 ? Math.round(((sentiment.positive + sentiment.supporter) / sentimentTotal) * 100) : 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Welcome, {session.user.name}</h1>
          <p className="text-gray-500 mt-2 font-medium">Your personal calling dashboard</p>
        </div>
        <Link href="/dashboard/workspace" className="inline-flex items-center gap-2 bg-[#164FA3] hover:bg-blue-800 text-white px-5 py-2.5 rounded-xl font-semibold shadow-md">
          Start Calling <ArrowRight size={16} />
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard label="Today's Calls" value={today.total} icon={PhoneCall} accent />
        <StatCard label="Connected" value={today.connected} icon={PhoneForwarded} />
        <StatCard label="Interested" value={today.interested} icon={Heart} />
        <StatCard label="Follow-ups" value={today.follow_ups} icon={TrendingUp} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 lg:col-span-2">
          <h2 className="font-bold text-lg text-gray-900 mb-6">Last 7 Days</h2>
          <div className="h-[260px]">
            {week.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-400">No calls yet this week</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={week.map(d => ({ day: new Date(d.day).toLocaleDateString("en-GB", { weekday: "short" }), calls: Number(d.calls) }))}>
                  <CartesianGrid stroke="#eee" strokeDasharray="5 5" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: "#6B7280", fontSize: 12 }} />
                  <YAxis tick={{ fill: "#6B7280", fontSize: 12 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="calls" stroke="#164FA3" strokeWidth={3} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-[#FCB712]/10 text-[#FCB712] flex items-center justify-center">
                <Trophy size={20} />
              </div>
              <span className="font-bold text-gray-900">Today's Rank</span>
            </div>
            {rank.position ? (
              <>
                <h3 className="text-3xl font-bold text-gray-900">#{rank.position}<span className="text-gray-400 text-lg"> / {rank.team_size}</span></h3>
                <p className="text-sm text-gray-500 mt-1">Among standard callers</p>
              </>
            ) : (
              <p className="text-gray-400 text-sm">Not ranked yet</p>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Heart size={20} />
              </div>
              <span className="font-bold text-gray-900">Supporter Rate</span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900">{supporterRate}%</h3>
            <p className="text-sm text-gray-500 mt-1">All-time positive responses</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, accent }) {
  return (
    <div className={`${accent ? "bg-[#164FA3] text-white" : "bg-white"} rounded-2xl p-6 shadow-sm border border-gray-100 flex flex-col gap-4`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${accent ? "bg-white/20 text-white" : "bg-gray-100 text-[#164FA3]"}`}>
        <Icon size={20} />
      </div>
      <div>
        <h3 className={`text-3xl font-bold tracking-tighter ${accent ? "text-white" : "text-gray-900"}`}>{value}</h3>
        <p className={`text-sm font-medium mt-1 ${accent ? "text-blue-200" : "text-gray-500"}`}>{label}</p>
      </div>
    </div>
  );
}
