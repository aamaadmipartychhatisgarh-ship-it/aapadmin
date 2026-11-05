"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

// Entry point of the installed app (the manifest's start_url) and the recovery page the service worker serves when the web server
// refuses a direct page load. It never shows content of its own: once the session is known it moves, INSIDE the app (no new page
// request to the server), to the page asked for in ?to= (only an in-app /dashboard address is accepted) or the role's home, or to the
// login page when signed out.
export default function LaunchPage() {
  const router = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") { router.replace("/login"); return; }
    let target = "/dashboard";
    try {
      const to = new URLSearchParams(window.location.search).get("to");
      if (to) {
        const u = new URL(to, window.location.origin);
        if (u.origin === window.location.origin && (u.pathname === "/dashboard" || u.pathname.startsWith("/dashboard/"))) target = u.pathname + u.search;
      }
    } catch { /* keep the default */ }
    router.replace(target);
  }, [status, router]);

  return (
    <div className="flex h-screen items-center justify-center bg-[#0B3A82]">
      <Loader2 className="animate-spin text-white" size={28} />
    </div>
  );
}
