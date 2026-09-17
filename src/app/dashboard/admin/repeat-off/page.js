"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { PhoneOff, Loader2 } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import RepeatOffPanel from "@/components/RepeatOffPanel";
import { isAdmin } from "@/lib/permissions";
import { usePageGuard } from "@/components/usePageGuard";

const TABS = [
  { key: "switched", label: "10+ Times Switched Off" },
  { key: "incoming", label: "10+ Times Incoming Off" },
];

export default function RepeatOffPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { ready, allowed } = usePageGuard("contacts", isAdmin(session));

  // Initial tab from ?type= (client-only read, so no Suspense needed).
  const [tab, setTab] = useState(() => {
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("type");
      if (t === "incoming" || t === "switched") return t;
    }
    return "switched";
  });

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (ready && !allowed) router.push("/dashboard");
  }, [status, ready, allowed, router]);

  if (!ready || !allowed) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={PhoneOff}
        title="Repeatedly Off Contacts"
        description="Contacts dispositioned Switched Off or Incoming Off more than 10 times — excluded from the main Contacts list. Nothing is deleted."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "Contacts", href: "/dashboard/admin/contacts" }, { label: "10+ Times Off" }]}
      />

      <div className="flex items-center gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3.5 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === t.key ? "border-[#164FA3] text-[#164FA3]" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <RepeatOffPanel type={tab} />
    </div>
  );
}
