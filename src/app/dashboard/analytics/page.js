"use client";

import SupervisorGuard from "@/components/SupervisorGuard";
import { BarChart3 } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import AnalyticsPanel from "@/components/AnalyticsPanel";

export default function Page() {
  return <SupervisorGuard><Body /></SupervisorGuard>;
}

function Body() {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={BarChart3}
        title="Analytics"
        description="Visualize calling activity across every dimension."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "Analytics" }]}
      />
      <AnalyticsPanel />
    </div>
  );
}
