"use client";

import { useSession } from "next-auth/react";
import { usePageAccess } from "@/components/usePageAccess";

// Unified CLIENT page guard — the single rule every protected page uses so the
// sidebar, the route, and the backend all agree on who may see a page.
//
// It mirrors the backend pageAllowed() / getEffectivePageKeys() exactly:
//   • MANAGED user (Page-Access configured for them, restricted=true) → allowed
//     only if this page key is in their effective set (their explicit grants
//     PLUS their role's fixed/locked pages). Role defaults are suppressed, just
//     like the backend — so a granted page (e.g. Caller Report) opens without an
//     Access-Denied bounce, and a removed page is blocked.
//   • UNMANAGED user → their normal role check (roleOk), unchanged. Existing
//     role-based access is never narrowed by this system.
//   • Super Admin is unmanaged with every page in their effective set, so either
//     branch admits them.
//
// `roleOk` is the page's existing role expression (e.g. isAdmin(session)).
// Returns { ready, allowed }: render a loader until `ready`, then the page if
// `allowed`, else let the caller redirect / show its own denied state. The
// dashboard layout ALSO render-blocks unauthorized managed pages, so this is the
// page-local half of the same single source of truth (usePageAccess → my-pages).
export function usePageGuard(pageKey, roleOk) {
  const { status } = useSession();
  const { pages, restricted, loading } = usePageAccess();
  const ready = status !== "loading" && !loading && (status !== "authenticated" || pages !== null);
  const granted = Array.isArray(pages) && !!pageKey ? pages.includes(pageKey) : false;
  const allowed =
    status === "authenticated" && (restricted ? granted : !!roleOk);
  return { ready, allowed, status };
}
