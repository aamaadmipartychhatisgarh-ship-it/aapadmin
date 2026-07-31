"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

// The standalone Teams page was merged into the Administration hub as its
// "Teams" tab (src/app/dashboard/admin/administration/TeamsTab.jsx) — this
// route now just forwards old links/bookmarks there instead of 404ing.
// Team detail (member management) is unaffected — still its own route at
// /dashboard/admin/teams/[id].
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    qs.set("tab", "teams");
    router.replace(`/dashboard/admin/administration?${qs}`);
  }, [router]);
  return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
}
