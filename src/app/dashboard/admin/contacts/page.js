"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { isAdmin } from "@/lib/permissions";
import { usePageGuard } from "@/components/usePageGuard";
import ContactsModule from "@/components/contacts/ContactsModule";

// Thin auth-gate wrapper — the actual Contacts UI/workflow lives in the ONE
// shared ContactsModule, rendered here in "admin" mode and by
// /dashboard/supervisor/contacts in "supervisor" mode. Same component either
// way; only the API endpoints it talks to (and a couple of admin-only
// conveniences that were never part of a Supervisor's granted permissions)
// differ, and that's config inside ContactsModule, not a separate page.
export default function Page() {
  const { data: session, status } = useSession();
  const router = useRouter();
  // Role OR a Page-Access grant for this page (managed override).
  const { ready, allowed } = usePageGuard("contacts", isAdmin(session));

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (ready && !allowed) router.push("/dashboard");
  }, [status, ready, allowed, router]);

  if (!ready || !allowed) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <ContactsModule session={session} mode="admin" />;
}
