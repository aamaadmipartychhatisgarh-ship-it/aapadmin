"use client";

import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { isOversight } from "@/lib/permissions";
import { pageKeyForPath } from "@/lib/pages";
import { usePageAccess } from "@/components/usePageAccess";

// Gate for oversight-only pages. Pass `allow` (a session predicate) to also
// admit a dedicated role, e.g. <SupervisorGuard allow={canAccessMedia}>.
//
// BUG 14: a page a Super Admin has explicitly GRANTED to a user is also
// admitted here — the guard checks the user's effective page access (baseline
// ∪ grants) for the current route. Oversight/`allow` users keep their exact
// prior fast-path (permitted immediately, no waiting on the access fetch), so
// existing behaviour is unchanged; only otherwise-denied users get the extra
// grant check.
export default function SupervisorGuard({ children, allow }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const { pages, restricted, loading: accessLoading } = usePageAccess();

  // A page-restricted user's role no longer admits them anywhere — only their
  // assigned pages do (Page Access override model). Non-restricted users keep
  // the normal role check.
  const roleAllowed = (s) => !restricted && (isOversight(s) || (allow ? allow(s) : false));
  const pageKey = pageKeyForPath(pathname);
  const grantAllowed = !!(pageKey && pages && pages.includes(pageKey));
  const permitted = (s) => roleAllowed(s) || grantAllowed;

  // Until the grant list has loaded we can't say a non-role user is denied.
  const decided = status === "authenticated" && (roleAllowed(session) || !accessLoading);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (decided && !permitted(session)) {
      router.push("/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session, router, decided, grantAllowed]);

  if (status === "loading" || !session || !decided || !permitted(session)) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#164FA3] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }
  return children;
}
