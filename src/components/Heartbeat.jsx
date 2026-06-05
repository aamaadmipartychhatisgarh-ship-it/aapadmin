"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";

// Pings /api/heartbeat every 30 seconds while logged in so supervisors
// can see who's currently online.
export default function Heartbeat() {
  const { status } = useSession();

  useEffect(() => {
    if (status !== "authenticated") return;
    const ping = () => fetch("/api/heartbeat", { method: "POST" }).catch(() => {});
    ping();
    const id = setInterval(ping, 30000);
    return () => clearInterval(id);
  }, [status]);

  return null;
}
