"use client";

import SupervisorGuard from "@/components/SupervisorGuard";
import SummaryDashboard from "@/components/SummaryDashboard";

export default function SupervisorOverview() {
  return (
    <SupervisorGuard>
      <SummaryDashboard
        summaryUrl="/api/supervisor/summary"
        exportUrl="/api/supervisor/export/summary"
        title="Supervisor Overview"
      />
    </SupervisorGuard>
  );
}
