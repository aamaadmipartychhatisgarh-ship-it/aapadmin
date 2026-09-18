"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SupervisorGuard from "@/components/SupervisorGuard";
import StrengthView from "@/components/StrengthView";
import RankingsView from "@/components/RankingsView";
import AssemblyRankingView from "@/components/AssemblyRankingView";
import { Gauge, Trophy, ArrowLeft, LayoutDashboard } from "lucide-react";

// Combined Strength & Ranking view — opened from the Dashboard Overview's "Full
// ranking" button. Three tabs (State Overview / Strength / Ranking) that reuse the
// existing content components (same data/APIs, no duplication). State Overview
// carries the Assembly-wise Ranking (§1).
export default function Page() {
  return <SupervisorGuard><Body /></SupervisorGuard>;
}

const TABS = [
  { key: "overview", label: "State Overview", icon: LayoutDashboard },
  { key: "strength", label: "Strength", icon: Gauge },
  { key: "rankings", label: "Ranking", icon: Trophy },
];

function Body() {
  const [tab, setTab] = useState("overview"); // default: State Overview
  const router = useRouter();

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* This view is drilled into from the Dashboard (not a sidebar item), so it
          needs its own way back — to the dashboard it was opened from. */}
      <button
        onClick={() => router.push("/dashboard")}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#164FA3]"
      >
        <ArrowLeft size={15} /> Back to Dashboard
      </button>
      <div>
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Strength &amp; Ranking</h1>
        <p className="text-gray-500 mt-2 font-medium">State overview, organization strength and performance rankings.</p>
      </div>

      {/* Native-style tab switcher (matches the dashboard's Overview/Analytics tabs). */}
      <div className="flex items-center gap-1 border-b border-gray-200 -mb-px">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3.5 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${
                tab === t.key ? "border-[#164FA3] text-[#164FA3]" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* State Overview carries the Assembly-wise Ranking (§1); Strength and Ranking
          reuse the existing content components unchanged. */}
      {tab === "overview" ? (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">State Overview</h2>
            <p className="text-sm text-gray-500">State-level strength at a glance, with every assembly ranked by its worker count.</p>
          </div>
          <AssemblyRankingView />
        </div>
      ) : tab === "strength" ? <StrengthView /> : <RankingsView />}
    </div>
  );
}
