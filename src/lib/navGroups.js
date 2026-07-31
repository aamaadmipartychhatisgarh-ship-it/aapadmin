// Shared grouping of admin nav routes into sections. Used by SectionTabs (to
// show sibling pages as header text links) — the SidebarGroupsNav accordion
// that used to consume this was replaced by a flat icon rail (no grouping UI).
//
// Groups are keyed by href so they're robust to label changes.
export const GROUPS = [
  { key: "people", label: "People Management", hrefs: ["/dashboard/admin/workers", "/dashboard/admin/teams", "/dashboard/admin/users"] },
  { key: "calling", label: "Calling Management", hrefs: ["/dashboard/admin/contacts", "/dashboard/admin/calls", "/dashboard/admin/caller-report", "/dashboard/admin/assignment-rules", "/dashboard/admin/wrong-numbers"] },
  { key: "tasks", label: "Task Management", hrefs: ["/dashboard/tasks", "/dashboard/admin/events", "/dashboard/admin/complaints"] },
  { key: "analytics", label: "Analytics", hrefs: ["/dashboard/analytics", "/dashboard/reports", "/dashboard/rankings", "/dashboard/strength"] },
  { key: "monitoring", label: "Monitoring", hrefs: ["/dashboard/map", "/dashboard/social", "/dashboard/social-management"] },
  { key: "content", label: "Content", hrefs: ["/dashboard/media"] },
  { key: "admin", label: "Administration", hrefs: ["/dashboard/admin/settings", "/dashboard/admin/audit"] },
];

// Find the group that owns a given pathname (exact match, or a dynamic child
// route like /dashboard/admin/workers/123 under /dashboard/admin/workers).
export function groupForPath(pathname) {
  return (
    GROUPS.find((g) => g.hrefs.includes(pathname)) ||
    GROUPS.find((g) => g.hrefs.some((h) => pathname.startsWith(h + "/")))
  );
}
