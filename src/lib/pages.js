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
  { key: "contacts", label: "Contacts", href: "/dashboard/admin/contacts", prefixes: ["/dashboard/admin/contacts", "/dashboard/supervisor/contacts", "/dashboard/admin/contacts-hierarchy", "/dashboard/admin/contacts-incomplete"], icon: "UserCheck",
    roles: [...OVERSIGHT] },
  { key: "wrong_numbers", label: "Wrong Numbers", href: "/dashboard/admin/wrong-numbers", prefixes: ["/dashboard/admin/wrong-numbers"], icon: "AlertCircle",
    roles: [...OVERSIGHT, ROLES.CALLER] },
  // Wrong Numbers sub-tabs (in-page tabs of /dashboard/admin/wrong-numbers).
  // These are the only two SEPARATELY-ACCESSIBLE sections; the individual
  // disposition reasons (Opponent / Switched Off / Rude Behavior / …) are call
  // outcome CATEGORIES used to filter these lists, not routable pages.
  { key: "wn_wrong_list", label: "Wrong Numbers · List", href: "/dashboard/admin/wrong-numbers", prefixes: [], tab: true, parent: "wrong_numbers", icon: "AlertCircle",
    roles: [...OVERSIGHT] },
  { key: "not_interested", label: "Wrong Numbers · Not Interested", href: "/dashboard/admin/wrong-numbers", prefixes: [], tab: true, parent: "wrong_numbers", icon: "HeartCrack",
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
  // Sub-sections (tabs) of Leader Assessment — grantable individually in Page
  // Access. `tab: true` + empty prefixes means pageKeyForPath never resolves a
  // URL to them (the route stays governed by `leader_assessment`); they carry a
  // `parent` so the access model treats a parent grant as covering all its
  // children and any child grant as unlocking the parent page (see
  // pageAccess.getEffectivePageKeys / the guards). Overview is always available
  // to anyone who can open the module, so it needs no separate key.
  { key: "la_mla_profile", label: "MLA Information · MLA Profile", href: "/dashboard/leader-assessment?tab=mla", prefixes: [], tab: true, parent: "leader_assessment", icon: "UserSquare2",
    roles: [ROLES.SUPER_ADMIN, ROLES.STATE_ADMIN, ROLES.SUPERVISOR] },
  { key: "la_aap_candidates", label: "MLA Information · AAP Candidate", href: "/dashboard/leader-assessment?tab=candidates", prefixes: [], tab: true, parent: "leader_assessment", icon: "Users",
    roles: [ROLES.SUPER_ADMIN, ROLES.STATE_ADMIN, ROLES.SUPERVISOR] },
  { key: "la_comparison", label: "MLA Information · Comparison", href: "/dashboard/leader-assessment?tab=comparison", prefixes: [], tab: true, parent: "leader_assessment", icon: "BarChart3",
    roles: [ROLES.SUPER_ADMIN, ROLES.STATE_ADMIN, ROLES.SUPERVISOR] },
  { key: "media", label: "Media", href: "/dashboard/media", prefixes: ["/dashboard/media"], icon: "Newspaper",
    roles: [...OVERSIGHT, ROLES.PRESS_MEDIA, ROLES.MEDIA_USER] },
  // Media sub-tabs (in-page tabs of /dashboard/media). `tab: true` + empty
  // prefixes → the route stays governed by `media`; these gate WHICH tabs a
  // MANAGED user sees inside it. Container-only model: granting `media` alone
  // does NOT grant these — each is assigned independently.
  { key: "media_dashboard", label: "Media · Dashboard", href: "/dashboard/media", prefixes: [], tab: true, parent: "media", icon: "LayoutDashboard",
    roles: [...OVERSIGHT, ROLES.PRESS_MEDIA, ROLES.MEDIA_USER] },
  { key: "media_newspapers", label: "Media · Newspapers", href: "/dashboard/media", prefixes: [], tab: true, parent: "media", icon: "Newspaper",
    roles: [...OVERSIGHT, ROLES.PRESS_MEDIA, ROLES.MEDIA_USER] },
  { key: "media_channels", label: "Media · News Channels", href: "/dashboard/media", prefixes: [], tab: true, parent: "media", icon: "Tv",
    roles: [...OVERSIGHT, ROLES.PRESS_MEDIA, ROLES.MEDIA_USER] },
  { key: "media_conferences", label: "Media · Press Conferences", href: "/dashboard/media", prefixes: [], tab: true, parent: "media", icon: "Mic",
    roles: [...OVERSIGHT, ROLES.PRESS_MEDIA, ROLES.MEDIA_USER] },
  { key: "media_spokespersons", label: "Media · Spokespersons", href: "/dashboard/media", prefixes: [], tab: true, parent: "media", icon: "UserCheck",
    roles: [...OVERSIGHT, ROLES.PRESS_MEDIA, ROLES.MEDIA_USER] },
  // BUG 17 — the "Social Media" (War Room) page was removed entirely. Only the
  // Social Command centre (social_management) remains. No "social" page key
  // exists anymore, so it can't be granted in Page Access, appears in no nav,
  // and any stale page_permissions row for it is ignored (invalid key).
  { key: "social_management", label: "Social Command", href: "/dashboard/social-management", prefixes: ["/dashboard/social-management"], icon: "Share2",
    roles: [ROLES.SUPER_ADMIN, ROLES.STATE_ADMIN, ROLES.SOCIAL_MEDIA] },
  // Social Command sub-tabs (in-page tabs of /dashboard/social-management).
  { key: "social_dashboard", label: "Social · Dashboard", href: "/dashboard/social-management", prefixes: [], tab: true, parent: "social_management", icon: "LayoutDashboard",
    roles: [ROLES.SUPER_ADMIN, ROLES.STATE_ADMIN, ROLES.SOCIAL_MEDIA] },
  { key: "social_pages", label: "Social · Pages", href: "/dashboard/social-management", prefixes: [], tab: true, parent: "social_management", icon: "FileText",
    roles: [ROLES.SUPER_ADMIN, ROLES.STATE_ADMIN, ROLES.SOCIAL_MEDIA] },
  { key: "social_log", label: "Social · Post Log", href: "/dashboard/social-management", prefixes: [], tab: true, parent: "social_management", icon: "ClipboardList",
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
  // Master Data also has a standalone route (/dashboard/admin/settings) that
  // renders the SAME component as the Administration "master" tab — gate it here
  // so the route is protected under the same key (no separate list).
  { key: "master_data", label: "Master Data", href: "/dashboard/admin/administration?tab=master", prefixes: ["/dashboard/admin/settings"], tab: true, parent: "administration", icon: "Database",
    roles: [ROLES.SUPER_ADMIN] },
  { key: "caste_master", label: "Caste Master", href: "/dashboard/admin/administration?tab=castes", prefixes: [], tab: true, parent: "administration", icon: "UserCheck",
    roles: [...OVERSIGHT] },
  { key: "polling_master", label: "Polling Station Master", href: "/dashboard/admin/administration?tab=polling", prefixes: [], tab: true, parent: "administration", icon: "ClipboardList",
    roles: [...OVERSIGHT] },
  { key: "party_master", label: "Party Master", href: "/dashboard/admin/administration?tab=parties", prefixes: [], tab: true, parent: "administration", icon: "Flag",
    roles: [...OVERSIGHT] },
  // Administration people-management. Teams and Users are Administration tabs
  // AND have standalone routes (/dashboard/admin/teams, /dashboard/admin/users);
  // register the routes so Page Access can grant them and the routes are
  // protected. (The tabs' own visibility is still enforced by the Admin page.)
  { key: "teams", label: "Teams", href: "/dashboard/admin/teams", prefixes: ["/dashboard/admin/teams"], parent: "administration", icon: "Users",
    roles: [...OVERSIGHT] },
  { key: "users", label: "Users", href: "/dashboard/admin/users", prefixes: ["/dashboard/admin/users"], parent: "administration", icon: "UserCog",
    roles: [ROLES.SUPER_ADMIN] },
  // Audit Log — the admin activity trail.
  { key: "audit", label: "Audit Log", href: "/dashboard/admin/audit", prefixes: ["/dashboard/admin/audit"], icon: "FileText",
    roles: [...ADMIN] },
  // Supervisor Dashboard — one module covering the Overview + Live, Alerts,
  // Areas, Attendance, Callers, Follow-Ups, Remarks and Sentiment sub-pages
  // (they share the /dashboard/supervisor prefix; Contacts keeps its own key).
  { key: "supervisor", label: "Supervisor Dashboard", href: "/dashboard/supervisor", prefixes: ["/dashboard/supervisor"], icon: "Users",
    roles: [ROLES.SUPER_ADMIN, ROLES.STATE_ADMIN, ROLES.SUPERVISOR] },
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

// Nested-permission helpers — a page may declare a `parent` key, to ANY depth.
// Direct children of a node.
export function childKeysOf(parentKey) {
  return PAGES.filter((p) => p.parent === parentKey).map((p) => p.key);
}
export function parentKeyOf(key) {
  return byKey.get(key)?.parent || null;
}
// Every ancestor of a key, nearest → root (recursive, cycle-safe).
export function ancestorKeysOf(key) {
  const out = [];
  const seen = new Set();
  let p = parentKeyOf(key);
  while (p && !seen.has(p)) { out.push(p); seen.add(p); p = parentKeyOf(p); }
  return out;
}
// Every descendant of a key at ANY depth (recursive, cycle-safe).
export function descendantKeysOf(key) {
  const out = [];
  const seen = new Set();
  const stack = [...childKeysOf(key)];
  while (stack.length) {
    const k = stack.pop();
    if (seen.has(k)) continue;
    seen.add(k); out.push(k);
    stack.push(...childKeysOf(k));
  }
  return out;
}
// CONTAINER-ONLY nested model (children are INDEPENDENT), fully RECURSIVE so it
// works for a page nested at any depth:
//   • a grant implies ALL of its ancestors — so every container page/route up
//     the chain is reachable and appears in the nav for the granted node;
//   • a grant NEVER implies any descendant — each sub-page is assigned on its own.
// So assigning a level-3 page unlocks its parent and grandparent as containers,
// but assigning a parent grants none of its children.
export function expandPageKeys(keys) {
  const out = new Set(keys);
  for (const k of Array.from(out)) {
    for (const anc of ancestorKeysOf(k)) out.add(anc); // node ⇒ all ancestors (containers)
  }
  return out;
}
// True when `key` is allowed given a set of granted keys (recursive container
// model):
//   • the key is granted directly; OR
//   • ANY descendant of the key (at any depth) is granted — so an ancestor
//     container route is reachable for a granted deep node.
// A node is NEVER allowed merely because an ANCESTOR is granted — each page is
// authorized on its own grant. So a user sees exactly the pages assigned to them.
export function grantSetAllows(grants, key) {
  if (grants.has(key)) return true;
  if (descendantKeysOf(key).some((d) => grants.has(d))) return true; // descendant grant unlocks the container
  return false;
}
