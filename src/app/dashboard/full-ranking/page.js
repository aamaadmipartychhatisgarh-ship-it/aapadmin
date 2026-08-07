"use client";

import { useState } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import StrengthView from "@/components/StrengthView";
import RankingsView from "@/components/RankingsView";
import { Gauge, Trophy } from "lucide-react";

// Combined Full Ranking view — opened from the Dashboard Overview's "Full
// ranking" button. Two tabs (Strength / Rankings) that reuse the existing
// Strength and Rankings content components (same data/APIs, no duplication).
export default function Page() {
  return <SupervisorGuard><Body /></SupervisorGuard>;
}

const TABS = [
  { key: "strength", label: "Strength", icon: Gauge },
  { key: "rankings", label: "Rankings", icon: Trophy },
];

function Body() {
  const [tab, setTab] = useState("strength"); // default: Strength

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Full Ranking</h1>
        <p className="text-gray-500 mt-2 font-medium">Organization strength and performance rankings.</p>
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

      {tab === "strength" ? <StrengthView /> : <RankingsView />}
    </div>
  );
}
