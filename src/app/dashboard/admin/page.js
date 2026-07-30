"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { isAdmin } from "@/lib/permissions";
import SummaryDashboard from "@/components/SummaryDashboard";

// State Overview — the SAME dashboard as the Supervisor Overview (shared
// SummaryDashboard component), differing only in the data source: state-level,
// territory-scoped totals from /api/admin/state-summary.
export default function AdminDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [scope, setScope] = useState(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && !isAdmin(session)) router.push("/dashboard");
  }, [status, session, router]);

  // Territory label for the heading (State / Zone / District / Assembly Overview).
  useEffect(() => {
    if (status !== "authenticated" || !isAdmin(session)) return;
    fetch("/api/me/scope").then((r) => r.json()).then(setScope).catch(() => {});
  }, [status, session]);

  if (status !== "authenticated" || !isAdmin(session)) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  const titleByLevel = {
    state: "State Overview",
    zone: `Zone Overview · ${scope?.name || ""}`,
    district: `District Overview · ${scope?.name || ""}`,
    assembly: `Assembly Overview · ${scope?.name || ""}`,
  };
  const title = scope ? (titleByLevel[scope.level] || "State Overview") : "State Overview";

  return (
    <SummaryDashboard
      summaryUrl="/api/admin/state-summary"
      exportUrl="/api/supervisor/export/summary"
      title={title}
    />
  );
}
