"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isOversight } from "@/lib/permissions";

export default function SupervisorGuard({ children }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (status === "authenticated" && !isOversight(session)) {
      router.push("/dashboard");
    }
  }, [status, session, router]);

  if (status === "loading" || !session || !isOversight(session)) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#164FA3] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }
  return children;
}
