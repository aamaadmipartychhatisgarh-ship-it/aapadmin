"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isOversight } from "@/lib/permissions";

// Gate for oversight-only pages. Pass `allow` (a session predicate) to also
// admit a dedicated role, e.g. <SupervisorGuard allow={canAccessMedia}>.
export default function SupervisorGuard({ children, allow }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const permitted = (s) => isOversight(s) || (allow ? allow(s) : false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (status === "authenticated" && !permitted(session)) {
      router.push("/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session, router]);

  if (status === "loading" || !session || !permitted(session)) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#164FA3] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }
  return children;
}
