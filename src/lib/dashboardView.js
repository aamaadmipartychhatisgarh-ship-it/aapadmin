// Shared client-only helper for the Super Admin "Quick Dashboard Switch"
// preview (src/app/dashboard/layout.js). Kept out of the layout file so
// other client pages (e.g. workspace, supervisor/contacts) can read the
// current preview choice without importing the layout component itself.
export const VIEW_AS_KEY = "aap_dashboard_view_as";

export function getDashboardViewAs() {
  if (typeof window === "undefined") return "super_admin";
  const saved = window.localStorage.getItem(VIEW_AS_KEY);
  return saved === "supervisor" || saved === "caller" ? saved : "super_admin";
}
