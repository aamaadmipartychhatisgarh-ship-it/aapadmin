"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import RfaReviewList from "@/components/RfaReviewList";
import { isSuperAdmin } from "@/lib/permissions";

// Super Admin only (re-enforced by every /api/rfa route).
export default function RfaReviewPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const ok = status === "authenticated" && isSuperAdmin(session);
  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && !isSuperAdmin(session)) router.push("/dashboard");
  }, [status, session, router]);
  if (!ok) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  return (
    <div className="space-y-4">
      <PageHeader title="RfA Review List" description="Contacts submitted by a Supervisor-2 for Review for Announce" />
      <RfaReviewList />
    </div>
  );
}
