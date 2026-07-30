"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowRight } from "lucide-react";
import { isAdmin, normalizeRole, ROLES } from "@/lib/permissions";
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

  // Cross-navigation to the Supervisor Overview — top-tier admins only (same
  // gating and styling as before the redesign).
  const supervisorView = [ROLES.SUPER_ADMIN, ROLES.STATE_ADMIN].includes(normalizeRole(session.user.role)) ? (
    <Link
      href="/dashboard/supervisor"
      className="inline-flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium shadow-sm"
    >
      Supervisor View <ArrowRight size={16} />
    </Link>
  ) : null;

  return (
    <SummaryDashboard
      summaryUrl="/api/admin/state-summary"
      exportUrl="/api/supervisor/export/summary"
      title={title}
      headerAction={supervisorView}
    />
  );
}
