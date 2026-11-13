"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, UserCog, Loader2, Shield } from "lucide-react";
import { normalizeRole, ROLES } from "@/lib/permissions";
import { usePageAccess } from "@/components/usePageAccess";
import VacancyTreeMap from "./VacancyTreeMap";

const BRAND = "#164FA3";

// Designation Vacancies = the Tree Map only. The former "Main Organisation" and "Wings" list pages were removed; an
// old link to them (?tab=main / ?tab=wings) simply opens the Tree Map, with the obsolete parameter dropped from the URL.
export default function VacanciesPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const isSuper = normalizeRole(session?.user?.role) === ROLES.SUPER_ADMIN;
  const { has, loading: pagesLoading } = usePageAccess();
  const canAccess = isSuper || has("vacancies");

  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.has("tab")) { u.searchParams.delete("tab"); window.history.replaceState(null, "", u.toString()); }
    } catch { /* no window */ }
  }, []);

  if (authStatus === "loading" || (!isSuper && pagesLoading)) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="animate-spin" style={{ color: BRAND }} size={28} /></div>;
  }
  if (!canAccess) {
    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center">
        <div className="max-w-md w-full bg-white border border-gray-200 rounded-2xl shadow-sm p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4"><Shield size={26} /></div>
          <h2 className="text-lg font-bold text-gray-900">Access Denied</h2>
          <p className="text-sm text-gray-500 mt-2">You do not have access to the Designation Vacancies module.</p>
          <button onClick={() => router.push("/dashboard")} className="mt-6 h-10 px-5 rounded-lg text-white text-sm font-semibold" style={{ background: BRAND }}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1500px] mx-auto">
      {/* Back to the dashboard — Designation Vacancies is a standalone page (its own sidebar entry). */}
      <Link href="/dashboard" data-testid="back-to-designation"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#164FA3] mb-3">
        <ArrowLeft size={16} /> Back to Dashboard
      </Link>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white" style={{ background: BRAND }}><UserCog size={22} /></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Designation Vacancies &amp; Reminders</h1>
            <p className="text-sm text-gray-500">Live vacant posts across State → Lok Sabha → District → Assembly → Block, with WhatsApp reminders to the responsible person.</p>
          </div>
        </div>
      </div>

      <VacancyTreeMap />
    </div>
  );
}
