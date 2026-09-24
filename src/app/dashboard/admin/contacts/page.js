"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Users as UsersIcon, Star, UserCheck, AlertCircle, UserCog } from "lucide-react";
import { isAdmin, normalizeRole, ROLES } from "@/lib/permissions";
import { usePageGuard } from "@/components/usePageGuard";
import { usePageAccess } from "@/components/usePageAccess";
import ContactsModule from "@/components/contacts/ContactsModule";
import { WrongNumbersDashboard } from "@/app/dashboard/admin/wrong-numbers/page";

// Thin auth-gate wrapper — the actual Contacts UI/workflow lives in the ONE
// shared ContactsModule, rendered here in "admin" mode and by
// /dashboard/supervisor/contacts in "supervisor" mode. Same component either
// way; only the API endpoints it talks to (and a couple of admin-only
// conveniences that were never part of a Supervisor's granted permissions)
// differ, and that's config inside ContactsModule, not a separate page.
//
// The Contacts page also carries the module's sibling views as TABS: All Contacts,
// Active Workers, Influencers and Wrong Number. Wrong Number is no longer a
// standalone side-panel item — it opens here as a tab that renders the SAME
// existing Wrong Numbers dashboard (Not Interested / 10+ Times Switched Off / 10+
// Times Incoming Off), reusing its data / API / filters / permissions. Active
// Workers and Influencers stay their own pages; their tabs link across to them.
export default function Page() {
  const { data: session, status } = useSession();
  const router = useRouter();
  // Role OR a Page-Access grant for this page (managed override).
  const { ready, allowed } = usePageGuard("contacts", isAdmin(session));
  const isSuper = normalizeRole(session?.user?.role) === ROLES.SUPER_ADMIN;
  // Designation Vacancies is now a Contacts tab (its own page-access key still
  // governs who sees it), no longer a standalone sidebar page.
  const { has } = usePageAccess();

  // Which in-page tab is active ("all" contacts | "wrong" number). Seed from
  // ?tab=wrong so a direct link can open the Wrong Number tab.
  const [tab, setTab] = useState("all");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "wrong") setTab("wrong");
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (ready && !allowed) router.push("/dashboard");
  }, [status, ready, allowed, router]);

  if (!ready || !allowed) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  const tabCls = (active) =>
    `px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
      active ? "border-[#164FA3] text-[#164FA3]" : "border-transparent text-gray-500 hover:text-gray-800"}`;

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      {/* Tabs scroll horizontally on mobile so every tab stays reachable. Active
          Workers / Influencers are their own pages, so those tabs link across;
          All Contacts and Wrong Number render in place. */}
      <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto">
        <button className={tabCls(tab === "all")} onClick={() => setTab("all")}><UserCheck size={15} /> All Contacts</button>
        <Link href="/dashboard/admin/active-workers" className={tabCls(false)}><UsersIcon size={15} /> Active Workers</Link>
        {isSuper && <Link href="/dashboard/admin/influencers" className={tabCls(false)}><Star size={15} /> Influencers</Link>}
        <button className={tabCls(tab === "wrong")} onClick={() => setTab("wrong")}><AlertCircle size={15} /> Wrong Number</button>
        <Link href="/dashboard/admin/contacts-incomplete" className={tabCls(false)}><AlertCircle size={15} /> Incomplete Designation</Link>
        {(isSuper || has("vacancies")) && (
          <Link href="/dashboard/admin/vacancies" className={tabCls(false)}><UserCog size={15} /> Designation Vacancies</Link>
        )}
      </div>

      {tab === "wrong"
        ? <WrongNumbersDashboard session={session} oversight canDelete={isAdmin(session)} />
        : <ContactsModule session={session} mode="admin" />}
    </div>
  );
}
