"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { isSupervisorRole } from "@/lib/permissions";
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

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && !isSupervisorRole(session)) router.push("/dashboard");
  }, [status, session, router]);

  if (status !== "authenticated" || !isSupervisorRole(session)) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <ContactsModule session={session} mode="supervisor" />;
}
