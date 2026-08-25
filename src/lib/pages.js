// Central registry of every protected page/module in the app (BUG 14 — Page
// Access Management). This is the SINGLE source of truth used by:
//   • the "Select Page" dropdown in the Page Access console,
//   • the effective-access computation (baseline role access ∪ explicit grants),
//   • URL→page matching for both the client guard and backend API checks,
//   • the dynamic sidebar (granted pages are appended to a user's nav).
//
// Each page carries a STABLE key (never the display label, which may change),
// the canonical href, the URL prefixes that belong to it, an icon name (mapped
// to a lucide icon on the client) and the set of roles that already hold the
// page by role-based baseline. Effective access is baseline OR an explicit
// grant in page_permissions — so this layer only ever ADDS access on top of the
// existing role model; it never removes what a role can already reach.
//
// To register a NEW page later: add one entry here. Nothing else in the
// access-control system needs to change — the dropdown, the guard, the grants
// table and the dynamic nav all read from this list.

import { ROLES } from "@/lib/permissions";

const ADMIN = [
  ROLES.SUPER_ADMIN, ROLES.STATE_ADMIN, ROLES.ZONE_ADMIN,
  ROLES.DISTRICT_ADMIN, ROLES.ASSEMBLY_ADMIN,
];
const OVERSIGHT = [...ADMIN, ROLES.SUPERVISOR];

// Ordered so the dropdown / tables read top-down like the product's own nav.
export const PAGES = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", prefixes: ["/dashboard"], exact: true, icon: "LayoutDashboard",
    roles: [...OVERSIGHT, ROLES.CALLER, ROLES.WORKER] },
  { key: "workspace", label: "My Workspace", href: "/dashboard/workspace", prefixes: ["/dashboard/workspace"], icon: "Headphones",
    roles: [...OVERSIGHT, ROLES.CALLER] },
  { key: "calls", label: "Calls", href: "/dashboard/calls", prefixes: ["/dashboard/calls"], icon: "Database",
    roles: [ROLES.CALLER] },
  { key: "contacts", label: "Contacts", href: "/dashboard/admin/contacts", prefixes: ["/dashboard/admin/contacts", "/dashboard/supervisor/contacts", "/dashboard/admin/contacts-hierarchy"], icon: "UserCheck",
    roles: [...OVERSIGHT] },
  { key: "wrong_numbers", label: "Wrong Numbers", href: "/dashboard/admin/wrong-numbers", prefixes: ["/dashboard/admin/wrong-numbers"], icon: "AlertCircle",
    roles: [...OVERSIGHT, ROLES.CALLER] },
  { key: "call_records", label: "Call Records", href: "/dashboard/admin/calls", prefixes: ["/dashboard/admin/calls"], icon: "Database",
    roles: [...OVERSIGHT] },
  { key: "caller_report", label: "Caller Report", href: "/dashboard/admin/caller-report", prefixes: ["/dashboard/admin/caller-report"], icon: "TrendingUp",
    roles: [...OVERSIGHT] },
  { key: "complaints", label: "Complaints", href: "/dashboard/admin/complaints", prefixes: ["/dashboard/admin/complaints", "/dashboard/complaints"], icon: "MessageSquare",
    roles: [...OVERSIGHT, ROLES.CALLER] },
  { key: "tasks", label: "Tasks", href: "/dashboard/tasks", prefixes: ["/dashboard/tasks"], icon: "ClipboardList",
    roles: [...OVERSIGHT, ROLES.CALLER, ROLES.WORKER, ROLES.PRESS_MEDIA, ROLES.SOCIAL_MEDIA] },
  { key: "leader_assessment", label: "Leader Assessment", href: "/dashboard/leader-assessment", prefixes: ["/dashboard/leader-assessment"], icon: "Gauge",
    roles: [ROLES.SUPER_ADMIN, ROLES.STATE_ADMIN, ROLES.SUPERVISOR] },
  { key: "media", label: "Media", href: "/dashboard/media", prefixes: ["/dashboard/media"], icon: "Newspaper",
    roles: [...OVERSIGHT, ROLES.PRESS_MEDIA, ROLES.MEDIA_USER] },
  { key: "social", label: "Social Media", href: "/dashboard/social", prefixes: ["/dashboard/social"], icon: "Share2",
    roles: [...OVERSIGHT, ROLES.SOCIAL_MEDIA] },
  { key: "social_management", label: "Social Command", href: "/dashboard/social-management", prefixes: ["/dashboard/social-management"], icon: "Share2",
    roles: [ROLES.SUPER_ADMIN, ROLES.STATE_ADMIN, ROLES.SOCIAL_MEDIA] },
  { key: "reports", label: "Reports", href: "/dashboard/reports", prefixes: ["/dashboard/reports"], icon: "FileText",
    roles: [...OVERSIGHT] },
  { key: "analytics", label: "Analytics", href: "/dashboard/analytics", prefixes: ["/dashboard/analytics"], icon: "BarChart3",
    roles: [...OVERSIGHT] },
  { key: "strength", label: "Strength", href: "/dashboard/strength", prefixes: ["/dashboard/strength"], icon: "Gauge",
    roles: [...OVERSIGHT] },
  { key: "rankings", label: "Rankings", href: "/dashboard/rankings", prefixes: ["/dashboard/rankings", "/dashboard/full-ranking"], icon: "Trophy",
    roles: [...OVERSIGHT] },
  { key: "events", label: "Events", href: "/dashboard/admin/events", prefixes: ["/dashboard/admin/events"], icon: "CalendarClock",
    roles: [...OVERSIGHT] },
  { key: "number_corrections", label: "Number Corrections", href: "/dashboard/admin/number-corrections", prefixes: ["/dashboard/admin/number-corrections", "/dashboard/number-corrections"], icon: "Flag",
    roles: [ROLES.STATE_ADMIN, ROLES.ZONE_ADMIN, ROLES.DISTRICT_ADMIN, ROLES.ASSEMBLY_ADMIN] },
  { key: "administration", label: "Administration", href: "/dashboard/admin/administration", prefixes: ["/dashboard/admin/administration"], icon: "UserCog",
    roles: [...OVERSIGHT] },
  // Administration sub-pages (PROMPT 10 Part A). These are TABS on the
  // Administration route, not standalone routes, so they carry NO url prefix
  // (tab: true) — pageKeyForPath never resolves to them. Access is enforced by
  // the Administration page (tab visibility + entry) and by each master's own
  // API. Grantable through Page Access exactly like any other page.
  { key: "master_data", label: "Master Data", href: "/dashboard/admin/administration?tab=master", prefixes: [], tab: true, icon: "Database",
    roles: [ROLES.SUPER_ADMIN] },
  { key: "caste_master", label: "Caste Master", href: "/dashboard/admin/administration?tab=castes", prefixes: [], tab: true, icon: "UserCheck",
    roles: [...OVERSIGHT] },
  { key: "polling_master", label: "Polling Station Master", href: "/dashboard/admin/administration?tab=polling", prefixes: [], tab: true, icon: "ClipboardList",
    roles: [...OVERSIGHT] },
  { key: "party_master", label: "Party Master", href: "/dashboard/admin/administration?tab=parties", prefixes: [], tab: true, icon: "Flag",
    roles: [...OVERSIGHT] },
  { key: "training", label: "Training", href: "/dashboard/training", prefixes: ["/dashboard/training"], icon: "GraduationCap",
    roles: [...OVERSIGHT, ROLES.CALLER] },
];

// Pages that are NEVER gated by this system — every signed-in user reaches them
// (their own profile, the admin home hub). Matching these returns null below so
// the guard always permits them.
const UNGATED_PREFIXES = ["/dashboard/profile", "/dashboard/admin/administration"];

const byKey = new Map(PAGES.map((p) => [p.key, p]));
export const PAGE_KEYS = PAGES.map((p) => p.key);

export function getPage(key) {
  return byKey.get(key) || null;
}
export function isValidPageKey(key) {
  return byKey.has(key);
}

// Resolve a pathname to its owning page key (longest matching prefix wins so
// /dashboard/admin/calls maps to call_records, not dashboard). Returns null for
// ungated/utility paths — the guard treats null as "always allowed".
export function pageKeyForPath(pathname) {
  if (!pathname) return null;
  const path = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  if (UNGATED_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))) return null;
  let best = null;
  let bestLen = -1;
  for (const page of PAGES) {
    for (const pre of page.prefixes) {
      const isMatch = page.exact ? path === pre : path === pre || path.startsWith(pre + "/");
      if (isMatch && pre.length > bestLen) { best = page.key; bestLen = pre.length; }
    }
  }
  return best;
}

// The set of page keys a role holds by baseline (before any explicit grants).
export function baselinePagesForRole(role) {
  return PAGES.filter((p) => p.roles.includes(role)).map((p) => p.key);
}
