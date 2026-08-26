"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { isAdmin } from "@/lib/permissions";
import IncompleteDesignationView from "@/components/contacts/IncompleteDesignationView";

// Contacts → Incomplete Designation. Admin-gated (same as the Contacts page): a
// non-admin hitting this URL directly is redirected out, and the API enforces
// the Contacts permission too. It's a filtered VIEW of the existing contacts —
// no separate/duplicate contact store.
export default function Page() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && !isAdmin(session)) router.push("/dashboard");
  }, [status, session, router]);

  if (status !== "authenticated" || !isAdmin(session)) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <IncompleteDesignationView />;
}
