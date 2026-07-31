"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

// The standalone Contacts page was merged into the Workers page as its
// "Calling" tab (src/app/dashboard/admin/workers/CallingTab.jsx) — this
// route now just forwards old links/bookmarks there instead of 404ing.
// Any existing query string (e.g. ?filter=wrong from an old deep link) is
// carried over unchanged; CallingTab still reads ?filter= on mount.
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    qs.set("tab", "calling");
    router.replace(`/dashboard/admin/workers?${qs}`);
  }, [router]);
  return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
}
