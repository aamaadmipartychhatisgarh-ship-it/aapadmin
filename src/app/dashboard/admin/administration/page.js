"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, UserCog } from "lucide-react";
import { isOversight, isSuperAdmin } from "@/lib/permissions";
import PageHeader from "@/components/PageHeader";
import TeamsTab from "./TeamsTab";
import UsersTab from "./UsersTab";

const TABS = [
  { key: "teams", label: "Teams" },
  { key: "users", label: "Users" },
];

// The people-management hub — Teams and Users are tabs on one page rather
// than separate routes. Worker Management (a third "Workers" tab here, plus
// the standalone worker profile page and every /api/workers/* endpoint) was
// removed entirely; contacts are now fully standalone and no longer depend
// on a linked worker for anything (see src/lib/contactExtras.js's
// hasContactPhotoColumn and the contacts-only import-excel route).
export default function Page() {
  const { data: session, status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && !isOversight(session)) router.push("/dashboard");
  }, [status, session, router]);
  if (status !== "authenticated" || !isOversight(session)) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <Body session={session} />;
}

function Body({ session }) {
  // Users kept its original isSuperAdmin-only visibility (the only tier with
  // it in the sidebar before) — this gate neither loosens nor tightens what
  // existed for Users. Teams is visible to anyone who reached this page (the
  // outer gate above is already isOversight).
  const canSeeUsers = isSuperAdmin(session);
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(() => {
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t === "users" && canSeeUsers) return "users";
    }
    return "teams";
  });
  // The lazy initializer above only covers a hard page load. A client-side
  // redirect (the old /dashboard/admin/workers URLs bouncing here with
  // ?tab=teams — see next.config.mjs) mounts this component before
  // window.location has caught up, so also react to router-tracked search
  // params directly.
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "users" && canSeeUsers) setTab("users");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, canSeeUsers]);

  // Default landing tab is Teams — but if there are no teams yet and this
  // user can also see Users, land there instead so the default view isn't
  // empty. Only applies when no explicit ?tab= was given.
  useEffect(() => {
    if (!canSeeUsers || searchParams.get("tab")) return;
    fetch("/api/teams").then((r) => r.json()).then((d) => {
      if ((d.teams || []).length === 0) setTab("users");
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleTabs = TABS.filter((t) => t.key === "teams" || (t.key === "users" && canSeeUsers));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={UserCog}
        title="Administration"
        description="Manage teams and organization members."
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

      {tab === "teams" && <TeamsTab session={session} />}
      {tab === "users" && canSeeUsers && <UsersTab session={session} />}
    </div>
  );
}
