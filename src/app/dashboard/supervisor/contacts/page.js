"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Info } from "lucide-react";
import { isSupervisorRole, normalizeRole, ROLES } from "@/lib/permissions";
import { getDashboardViewAs } from "@/lib/dashboardView";
import ContactsModule from "@/components/contacts/ContactsModule";

// Thin auth-gate wrapper — the actual Contacts UI/workflow lives in the ONE
// shared ContactsModule (same component /dashboard/admin/contacts renders,
// just in "supervisor" mode). Identical layout, filters, distribution
// panel, and table; only the API endpoints it talks to are different
// (server-side territory scoping, never a frontend-only restriction) plus a
// couple of admin-only conveniences that were never part of a Supervisor's
// granted permissions (Add Contact, Excel/CSV import, editing a contact's
// geography, bulk-deleting Wrong Numbers).
export default function Page() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Quick Dashboard Switch (src/app/dashboard/layout.js): a Super Admin
  // previewing the Supervisor Dashboard lands here too, but this module's
  // data is tied to a real Supervisor's territory scope
  // (src/lib/supervisorScope.js) — there's nothing to compute for a Super
  // Admin account, and none of the hardened /api/supervisor/contacts/*
  // routes' isSupervisorRole gates should be loosened to fake one. So a
  // previewing Super Admin gets an honest explanation instead of either the
  // old hard redirect-away or a fake empty module.
  const [previewing, setPreviewing] = useState(false);
  const [checkedPreview, setCheckedPreview] = useState(false);
  useEffect(() => {
    setPreviewing(normalizeRole(session?.user?.role) === ROLES.SUPER_ADMIN && getDashboardViewAs() === "supervisor");
    setCheckedPreview(true);
  }, [session]);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && checkedPreview && !isSupervisorRole(session) && !previewing) router.push("/dashboard");
  }, [status, session, router, checkedPreview, previewing]);

  if (status !== "authenticated" || !checkedPreview) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  if (isSupervisorRole(session)) {
    return <ContactsModule session={session} mode="supervisor" />;
  }

  if (previewing) {
    return (
      <div className="max-w-lg mx-auto mt-12 bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center">
        <Info className="mx-auto text-[#164FA3] mb-3" size={28} />
        <h2 className="font-bold text-gray-900 mb-2">Supervisor Contacts is territory-scoped</h2>
        <p className="text-sm text-gray-600 mb-4">
          This module shows contacts scoped to a real Supervisor account&apos;s assigned territory.
          As Super Admin you already have unrestricted access — use the full Contacts module instead.
        </p>
        <Link href="/dashboard/admin/contacts" className="inline-block bg-[#164FA3] hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-xl">
          Go to Contacts
        </Link>
      </div>
    );
  }

  return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
}
