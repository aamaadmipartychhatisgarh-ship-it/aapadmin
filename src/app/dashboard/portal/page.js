"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LayoutDashboard, MessageSquare, Check, ArrowRight, Loader2 } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePageGuard } from "@/components/usePageGuard";

// Member Portal home — the landing for auto-provisioned designation-holder accounts.
// Managed accounts see exactly their granted pages; this is their dashboard with
// quick links to Announcements and Worker Approval.
export default function PortalHomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { ready, allowed } = usePageGuard("portal_home", false);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (ready && !allowed) router.push("/dashboard");
  }, [status, ready, allowed, router]);

  if (!ready || !allowed) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  const cards = [
    { href: "/dashboard/portal/announcements", icon: MessageSquare, title: "Announcements", desc: "Latest updates and notices from the party", color: "text-[#164FA3] bg-[#164FA3]/10" },
    { href: "/dashboard/supervisor/pending-contacts", icon: Check, title: "Worker Approval", desc: "Review and approve members submitted in your area", color: "text-emerald-600 bg-emerald-50" },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={LayoutDashboard} title={`Welcome${session?.user?.name ? `, ${session.user.name}` : ""}`} description="Your member portal." />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="group bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex items-center gap-4 hover:border-[#164FA3]/40 hover:shadow-md transition">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${c.color}`}><c.icon size={22} /></div>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-gray-900">{c.title}</div>
              <div className="text-sm text-gray-500">{c.desc}</div>
            </div>
            <ArrowRight size={18} className="text-gray-300 group-hover:text-[#164FA3]" />
          </Link>
        ))}
      </div>
    </div>
  );
}
