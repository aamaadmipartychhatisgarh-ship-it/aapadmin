"use client";

import { useState } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import { BarChart3, Activity, Trophy, Gauge } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import AnalyticsPanel from "@/components/AnalyticsPanel";
import LiveStatusView from "@/components/LiveStatusView";
import RankingsView from "@/components/RankingsView";
import StrengthView from "@/components/StrengthView";

export default function Page() {
  return <SupervisorGuard><Body /></SupervisorGuard>;
}

const TABS = [
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "live", label: "Live Status", icon: Activity },
  { key: "rankings", label: "Rankings", icon: Trophy },
  { key: "strength", label: "Strength", icon: Gauge },
];

function Body() {
  // Analytics is the default/first tab. A ?tab= deep-link opens straight to that
  // tab (e.g. old Live Status / Rankings / Strength links land here).
  const [tab, setTab] = useState(() => {
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (TABS.some((x) => x.key === t)) return t;
    }
    return "analytics";
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={BarChart3}
        title="Analytics"
        description="Visualize calling activity across every dimension."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "Analytics" }]}
      />

      {/* Native-style tab switcher (matches the dashboard's existing tabs). */}
      <div className="flex items-center gap-1 border-b border-gray-200 -mb-px overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3.5 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                tab === t.key ? "border-[#164FA3] text-[#164FA3]" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === "analytics" && <AnalyticsPanel />}
      {tab === "live" && <LiveStatusView />}
      {tab === "rankings" && <RankingsView />}
      {tab === "strength" && <StrengthView />}
    </div>
  );
}
