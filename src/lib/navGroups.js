// Shared grouping of admin nav routes into sections. Used by SectionTabs (to
// show sibling pages as header text links) — the SidebarGroupsNav accordion
// that used to consume this was replaced by a flat icon rail (no grouping UI).
//
// Groups are keyed by href so they're robust to label changes.
export const GROUPS = [
  // Administration: Teams + Users, tabs on one page
  // (src/app/dashboard/admin/administration). Worker Management (a former
  // third tab here) was removed entirely. Future modules (Roles, Permissions,
  // Departments, Designations, …) belong here too.
  { key: "people", label: "Administration", hrefs: ["/dashboard/admin/administration"] },
  // People: the day-to-day calling/contact operations. The header row reads
  // "Contacts | Call Records | Wrong Numbers" as one set. Administration is NOT
  // cross-listed here — it was removed from the Contacts module tabs and now
  // lives only under its own group above (still reachable from the sidebar).
  // (The Daily Assignment module was removed; the workspace's Call Assignment
  // logic that reads the assignment_rules table is unaffected.)
  { key: "calling", label: "People", hrefs: ["/dashboard/admin/contacts", "/dashboard/admin/calls", "/dashboard/admin/wrong-numbers"] },
  { key: "tasks", label: "Task Management", hrefs: ["/dashboard/tasks", "/dashboard/admin/events", "/dashboard/admin/complaints"] },
  // Every report/analytics page links to every other one (and to the main
  // Reports Center) via this single group — a page only appears here if the
  // signed-in role actually has it in their nav (see SectionTabs).
  {
    // Rankings (/dashboard/rankings) and Strength (/dashboard/strength) were
    // removed from this Reports & Analytics tab group per request, so they no
    // longer show as tabs in the Reports navigation. Both pages still exist and
    // stay reachable from the sidebar (not exclusive to Reports → no redirect).
    key: "analytics", label: "Reports & Analytics", hrefs: [
      "/dashboard/analytics", "/dashboard/reports",
      "/dashboard/admin/caller-report",
      "/dashboard/supervisor/areas", "/dashboard/supervisor/sentiment", "/dashboard/supervisor/remarks",
      "/dashboard/supervisor/attendance", "/dashboard/supervisor/callers",
    ],
  },
  { key: "monitoring", label: "Monitoring", hrefs: ["/dashboard/social", "/dashboard/social-management"] },
  { key: "content", label: "Content", hrefs: ["/dashboard/media"] },
  // Renamed from "Administration" to "System" — that label now belongs to
  // the Workers/Teams/Users group above, per the nav restructure.
  { key: "admin", label: "System", hrefs: ["/dashboard/admin/settings", "/dashboard/admin/audit"] },
];

// Find the group that owns a given pathname (exact match, or a dynamic child
// route under one of a group's hrefs, e.g. /dashboard/admin/teams/123 under
// /dashboard/admin/teams).
export function groupForPath(pathname) {
  return (
    GROUPS.find((g) => g.hrefs.includes(pathname)) ||
    GROUPS.find((g) => g.hrefs.some((h) => pathname.startsWith(h + "/")))
  );
}

// Sibling pages of the current route's group — the same set SectionTabs and
// the header quick-jump icons both surface (a page only appears if it's
// actually present in `items`, since roles carry different item sets).
export function siblingsForPath(pathname, items) {
  const group = groupForPath(pathname);
  if (!group) return [];
  return group.hrefs.map((h) => items.find((i) => i.href === h)).filter(Boolean);
}

// Reduce a role's full nav item list down to one "primary" entry per group
// (the group's first href that the role actually has) plus every item that
// isn't part of any group at all (e.g. Dashboard). Used to keep the sidebar
// short — the rest of each group is reachable from the primary page's header
// (see SectionTabs / header quick-jump icons), not listed again in the sidebar.
export function primaryItems(items) {
  const allGroupedHrefs = new Set(GROUPS.flatMap((g) => g.hrefs));
  const ungrouped = items.filter((i) => !allGroupedHrefs.has(i.href));
  const primaries = GROUPS
    .map((g) => g.hrefs.map((h) => items.find((i) => i.href === h)).find(Boolean))
    .filter(Boolean);
  // Preserve the original nav order rather than the group-definition order.
  const keep = new Set([...ungrouped, ...primaries].map((i) => i.href));
  return items.filter((i) => keep.has(i.href));
}
