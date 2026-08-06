"use client";

import { useState, useEffect } from "react";
import { normalizeRole, ROLES } from "@/lib/permissions";
import { getDashboardViewAs, getViewAsUser } from "@/lib/dashboardView";

// Shared client helper for the pages that live under /dashboard but ARE the
// caller's own pages (Dashboard, Log a Call, My Calls, Complaints, My Tasks).
// Each of those pages bounces an oversight role (admin/supervisor) back to an
// admin page — correct for a real admin, but wrong for a Super Admin who is
// previewing a specific caller via the Quick Dashboard Switch (see
// src/app/dashboard/layout.js). While previewing, these pages must render their
// OWN caller UI in place instead of redirecting, so navigation between caller
// menu items actually changes the content.
//
// Security: this NEVER grants privilege. It only decides whether to skip a
// navigation redirect, and it is honored ONLY for a genuine Super Admin whose
// preview mode is "caller". The matching server-side impersonation (whose data
// is served) is gated independently in src/lib/actAs.js, which re-verifies the
// real role and that the selected target is a real, active caller.

// Synchronous check — safe to call INSIDE a redirect effect. The stateful hook
// below lags the real value by one render (it commits after mount to avoid a
// hydration mismatch), and a redirect effect that read that stale state would
// fire the redirect a render too early. Reading localStorage synchronously here
// avoids that race. Returns false during SSR (no window).
export function isPreviewingCallerNow(session) {
  if (typeof window === "undefined") return false;
  return normalizeRole(session?.user?.role) === ROLES.SUPER_ADMIN && getDashboardViewAs() === "caller";
}

// Stateful version for RENDER decisions (guards, which body to show, banners).
// Starts false so the first client render matches the server (no hydration
// mismatch), then commits the real value after mount. Re-checked against the
// real role, so a stale localStorage value from a previous session on the same
// browser can never let a non-super_admin bypass a redirect.
export function useCallerPreview(session) {
  const [previewingCaller, setPreviewingCaller] = useState(false);
  const [viewAsCaller, setViewAsCaller] = useState(null);
  useEffect(() => {
    const previewing = isPreviewingCallerNow(session);
    setPreviewingCaller(previewing);
    setViewAsCaller(previewing ? getViewAsUser() : null);
  }, [session]);
  return { previewingCaller, viewAsCaller };
}
