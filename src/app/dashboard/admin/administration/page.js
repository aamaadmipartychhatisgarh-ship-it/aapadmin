"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, UserCog } from "lucide-react";
import { canManageWorkers, isOversight, isSuperAdmin } from "@/lib/permissions";
import PageHeader from "@/components/PageHeader";
import WorkersTab from "./WorkersTab";
import TeamsTab from "./TeamsTab";
import UsersTab from "./UsersTab";

const TABS = [
  { key: "workers", label: "Workers" },
  { key: "teams", label: "Teams" },
  { key: "users", label: "Users" },
];

// The consolidated people-management hub — replaces the standalone Workers,
// Teams and Users pages. Worker management, the contact-assignment/
// distribution panel, and Worker Activity stats all live under the
// "Workers" tab (see WorkersTab.jsx); Teams and Users are separate tabs on
// the same page rather than separate routes, so there's a single place to
// manage people instead of three.
export default function Page() {
  const { data: session, status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && !canManageWorkers(session)) router.push("/dashboard");
  }, [status, session, router]);
  if (status !== "authenticated" || !canManageWorkers(session)) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <Body session={session} />;
}

function Body({ session }) {
  // Teams kept its original isOversight gate (admins + supervisor could
  // always view it, isAdmin only gated the edit controls) — Users kept its
  // stricter isSuperAdmin-only visibility (the only tier with it in the
  // sidebar before). Neither gate loosens or tightens what existed.
  const canSeeTeams = isOversight(session);
  const canSeeUsers = isSuperAdmin(session);
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(() => {
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t === "teams" && canSeeTeams) return "teams";
      if (t === "users" && canSeeUsers) return "users";
    }
    return "workers";
  });
  // The lazy initializer above only covers a hard page load. A client-side
  // redirect (the old /dashboard/admin/{workers,teams,users} routes
  // bouncing here with ?tab=...) mounts this component before
  // window.location has caught up, so also react to router-tracked search
  // params directly (same fix applied to the Workers/Calling tabs earlier).
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "teams" && canSeeTeams) setTab("teams");
    else if (t === "users" && canSeeUsers) setTab("users");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, canSeeTeams, canSeeUsers]);

  const visibleTabs = TABS.filter((t) => t.key === "workers" || (t.key === "teams" && canSeeTeams) || (t.key === "users" && canSeeUsers));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={UserCog}
        title="Administration"
        description="Manage workers, contact assignment, teams and organization members."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "Administration" }]}
      />

      {visibleTabs.length > 1 && (
        <div className="flex items-center gap-1 border-b border-gray-200 -mb-2">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3.5 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                tab === t.key ? "border-[#164FA3] text-[#164FA3]" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === "workers" && <WorkersTab session={session} />}
      {tab === "teams" && canSeeTeams && <TeamsTab session={session} />}
      {tab === "users" && canSeeUsers && <UsersTab session={session} />}
    </div>
  );
}
