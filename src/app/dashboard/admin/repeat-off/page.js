"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

// Legacy page: the 10+ Times Switched Off / Incoming Off lists now live on the consolidated Status Management page.
// Old links keep working and land with the matching Status selected (?type=switched | incoming).
export default function RepeatOffPage() {
  const router = useRouter();
  useEffect(() => {
    let st = "Switched Off";
    try { if (new URLSearchParams(window.location.search).get("type") === "incoming") st = "Incoming Off"; } catch {}
    router.replace(`/dashboard/admin/wrong-numbers?status=${encodeURIComponent(st)}`);
  }, [router]);
  return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
}
