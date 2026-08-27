"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { isAdmin } from "@/lib/permissions";
import { usePageGuard } from "@/components/usePageGuard";
import IncompleteDesignationView from "@/components/contacts/IncompleteDesignationView";

// Contacts → Incomplete Designation. Admin-gated (same as the Contacts page): a
// non-admin hitting this URL directly is redirected out, and the API enforces
// the Contacts permission too. It's a filtered VIEW of the existing contacts —
// no separate/duplicate contact store.
export default function Page() {
  const { data: session, status } = useSession();
  const router = useRouter();
  // Incomplete Designation lives under the Contacts page key (managed override).
  const { ready, allowed } = usePageGuard("contacts", isAdmin(session));

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (ready && !allowed) router.push("/dashboard");
  }, [status, ready, allowed, router]);

  if (!ready || !allowed) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <IncompleteDesignationView />;
}
