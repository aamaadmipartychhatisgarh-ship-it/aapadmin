"use client";

import SupervisorGuard from "@/components/SupervisorGuard";
import CallerPerformanceView from "@/components/CallerPerformanceView";

export default function Page() {
  return (
    <SupervisorGuard>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Caller Performance</h1>
          <p className="text-gray-500 mt-2 font-medium">Ranked by total calls. Includes connected, follow-ups, avg duration.</p>
        </div>
        <CallerPerformanceView />
      </div>
    </SupervisorGuard>
  );
}
