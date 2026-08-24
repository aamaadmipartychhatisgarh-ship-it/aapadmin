"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, UserCog, CheckCircle2, AlertCircle } from "lucide-react";
import { isOversight, isSuperAdmin, normalizeRole } from "@/lib/permissions";
import { baselinePagesForRole } from "@/lib/pages";
import { usePageAccess } from "@/components/usePageAccess";
import PageHeader from "@/components/PageHeader";
import TeamsTab from "./TeamsTab";
import UsersTab from "./UsersTab";
import MasterDataSettings from "../settings/page";
// Caste Master + Voter (Polling Station) Master were moved here from the Leader
// Assessment module. Reuse the EXACT same components (same APIs, same records) —
// no duplicate implementation.
import { CasteMaster, PollingMaster } from "@/app/dashboard/leader-assessment/page";
import PartyMaster from "@/components/PartyMaster";
import PageAccessManager from "@/components/PageAccessManager";

const TABS = [
  { key: "teams", label: "Teams" },
  { key: "users", label: "Users" },
  { key: "master", label: "Master Data" },
  { key: "castes", label: "Caste Master" },
  { key: "polling", label: "Polling Station Master" },
  { key: "parties", label: "Party Master" },
  { key: "page_access", label: "Page Access" },
];
// The four master-data admin tabs are grantable through Page Access (PROMPT 10
// Part A); each maps to a stable page key. Visibility here and the tab's own API
// read from the SAME effective access (role baseline ∪ Super-Admin grant), so a
// removed user can neither see the tab nor load its data.
const TAB_PAGE_KEY = {
  master: "master_data",
  castes: "caste_master",
  polling: "polling_master",
  parties: "party_master",
};

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
  }, [status, router]);
  if (status !== "authenticated") {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <Body session={session} />;
}

function Body({ session }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Effective page access. For a page-restricted user (≥1 assigned page) access
  // is EXACTLY the assigned pages — their role (oversight/super) is ignored, so
  // Teams / Users / Page Access and any role-baseline master tabs are hidden
  // unless explicitly assigned. Non-restricted users keep their role visibility.
  const { pages: accessKeys, restricted, loading: accessLoading } = usePageAccess();
  const oversight = !restricted && isOversight(session);
  const canSeeUsers = !restricted && isSuperAdmin(session);
  const baseline = new Set(baselinePagesForRole(normalizeRole(session?.user?.role)));
  const effective = new Set(accessKeys || []);
  const canPage = (key) => restricted ? effective.has(key) : (baseline.has(key) || effective.has(key));
  const canTab = (tabKey) => {
    if (tabKey === "teams") return oversight;
    if (tabKey === "users" || tabKey === "page_access") return canSeeUsers;
    const pk = TAB_PAGE_KEY[tabKey];
    return pk ? canPage(pk) : false;
  };
  const visibleTabs = TABS.filter((t) => canTab(t.key));
  // Wait for /api/my-pages before deciding — restriction status flips role
  // visibility, so we must not render (or redirect) on the pre-load default.
  const decided = !accessLoading;

  const [tab, setTab] = useState(() => {
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t && TABS.some((x) => x.key === t)) return t;
    }
    return "teams";
  });
  const [toast, setToast] = useState(null); // { kind: 'ok'|'err', text }
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 3500); return () => clearTimeout(id); }, [toast]);
  const flash = (m) => setToast({ kind: "ok", text: m });
  const fail = (m) => setToast({ kind: "err", text: m });

  // Honor ?tab= when that tab is actually permitted for this user.
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && canTab(t)) setTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, accessLoading]);

  // Once access is decided, keep the active tab on something the user may see;
  // if they can see nothing here at all, bounce them out (covers a removed user
  // hitting a tab's URL directly — §"cannot open the page directly").
  useEffect(() => {
    if (!decided) return;
    if (visibleTabs.length === 0) { router.push("/dashboard"); return; }
    if (!visibleTabs.some((t) => t.key === tab)) setTab(visibleTabs[0].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decided, visibleTabs.map((t) => t.key).join(","), tab]);

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

  // A grant-only user whose access hasn't resolved yet — show a spinner rather
  // than briefly flashing an empty page or a wrong redirect.
  if (!decided) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {toast && (
        <div className={`fixed top-4 right-4 z-[80] flex items-center gap-2 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg ${toast.kind === "ok" ? "bg-emerald-600" : "bg-red-600"}`}>
          {toast.kind === "ok" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}{toast.text}
        </div>
      )}
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

      {tab === "teams" && canTab("teams") && <TeamsTab session={session} />}
      {tab === "users" && canTab("users") && <UsersTab session={session} />}
      {tab === "master" && canPage("master_data") && <MasterDataSettings embedded />}
      {tab === "castes" && canPage("caste_master") && <CasteMaster flash={flash} fail={fail} />}
      {tab === "polling" && canPage("polling_master") && <PollingMaster flash={flash} fail={fail} />}
      {tab === "parties" && canPage("party_master") && <PartyMaster flash={flash} fail={fail} />}
      {tab === "page_access" && canTab("page_access") && <PageAccessManager />}
    </div>
  );
}
