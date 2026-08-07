"use client";

import SupervisorGuard from "@/components/SupervisorGuard";
import StrengthView from "@/components/StrengthView";

export default function Page() {
  return (
    <SupervisorGuard>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Organization Strength</h1>
          <p className="text-gray-500 mt-2 font-medium">Composite score: workers, activity, teams & calling per district.</p>
        </div>
        <StrengthView />
      </div>
    </SupervisorGuard>
  );
}
