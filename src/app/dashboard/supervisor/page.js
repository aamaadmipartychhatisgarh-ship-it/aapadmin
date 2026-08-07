"use client";

import { useState } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import SummaryDashboard from "@/components/SummaryDashboard";
import CallerPerformanceView from "@/components/CallerPerformanceView";
import SentimentView from "@/components/SentimentView";
import { LayoutDashboard, TrendingUp, MessageSquare } from "lucide-react";

export default function SupervisorOverview() {
  return <SupervisorGuard><Body /></SupervisorGuard>;
}

const TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "callers", label: "Caller Performance", icon: TrendingUp },
  { key: "sentiment", label: "Sentiments", icon: MessageSquare },
];

function Body() {
  // Overview is the default/first tab. A ?tab= deep-link opens straight to a tab
  // (old Caller Performance / Sentiments links land here).
  const [tab, setTab] = useState(() => {
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (TABS.some((x) => x.key === t)) return t;
    }
    return "overview";
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
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

      {tab === "overview" && (
        <SummaryDashboard summaryUrl="/api/supervisor/summary" exportUrl="/api/supervisor/export/summary" title="Supervisor Overview" />
      )}
      {tab === "callers" && <CallerPerformanceView />}
      {tab === "sentiment" && <SentimentView />}
    </div>
  );
}
