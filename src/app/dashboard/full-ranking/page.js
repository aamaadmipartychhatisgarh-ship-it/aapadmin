"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SupervisorGuard from "@/components/SupervisorGuard";
import StrengthView from "@/components/StrengthView";
import AssemblyRankingView from "@/components/AssemblyRankingView";
import { Gauge, ArrowLeft, MapPin } from "lucide-react";

// Area Ranking & Strength — opened from the Dashboard Overview's "Area ranking"
// button. Two tabs (Area Ranking / Strength) that reuse the existing content
// components (same data/APIs, no duplication). The former "State Overview" tab
// and the obsolete performance "Ranking" tab have been removed; the Assembly-wise
// ranking lives under "Area Ranking" (all assemblies + each assembly's current
// member, the Vidhansabha Prabhari).
export default function Page() {
  return <SupervisorGuard><Body /></SupervisorGuard>;
}

const TABS = [
  { key: "area", label: "Area Ranking", icon: MapPin },
  { key: "strength", label: "Strength", icon: Gauge },
];

function Body() {
  const [tab, setTab] = useState("area"); // default: Area Ranking
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
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Area Ranking &amp; Strength</h1>
        <p className="text-gray-500 mt-2 font-medium">Every assembly ranked by worker count with its current member, and organization strength.</p>
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

      {/* Area Ranking carries the Assembly-wise ranking (all assemblies, each with
          its current member); Strength reuses the existing content component. */}
      {tab === "area" ? (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Area Ranking</h2>
            <p className="text-sm text-gray-500">Every assembly ranked by its worker count, with its current member.</p>
          </div>
          <AssemblyRankingView />
        </div>
      ) : <StrengthView />}
    </div>
  );
}
