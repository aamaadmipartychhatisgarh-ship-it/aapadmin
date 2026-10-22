"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

// Unfiltered Calls are worked inside My Workspace (Regular Calls ↔ Unfiltered
// Calls switch). This route stays for old links / the sidebar entry and simply
// opens the workspace on the Unfiltered Calls view.
export default function UnfilteredCallsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/dashboard/workspace?calls=unfiltered"); }, [router]);
  return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
}
