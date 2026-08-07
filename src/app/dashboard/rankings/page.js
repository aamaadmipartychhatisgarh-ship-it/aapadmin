"use client";

import SupervisorGuard from "@/components/SupervisorGuard";
import RankingsView from "@/components/RankingsView";

export default function Page() {
  return (
    <SupervisorGuard>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Rankings & Rewards</h1>
          <p className="text-gray-500 mt-2 font-medium">Top performers, area leaderboards and achievement badges.</p>
        </div>
        <RankingsView />
      </div>
    </SupervisorGuard>
  );
}
