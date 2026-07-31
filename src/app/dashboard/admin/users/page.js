"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

// The standalone Users page was merged into the Administration hub as its
// "Users" tab (src/app/dashboard/admin/administration/UsersTab.jsx) — this
// route now just forwards old links/bookmarks there instead of 404ing.
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    qs.set("tab", "users");
    router.replace(`/dashboard/admin/administration?${qs}`);
  }, [router]);
  return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
}
