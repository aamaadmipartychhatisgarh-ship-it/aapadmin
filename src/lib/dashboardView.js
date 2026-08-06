// Shared client-only helper for the Super Admin "Quick Dashboard Switch"
// preview (src/app/dashboard/layout.js). Kept out of the layout file so
// other client pages (e.g. workspace, supervisor/contacts) can read the
// current preview choice without importing the layout component itself.
export const VIEW_AS_KEY = "aap_dashboard_view_as";
// The specific caller a Super Admin is impersonating from the Caller Dashboard
// submenu. localStorage holds { id, name } for the UI; a matching cookie
// (read server-side by src/lib/actAs.js) tells the workspace APIs whose data
// to serve. Both names must stay in sync with actAs.js.
export const VIEW_AS_USER_KEY = "aap_dashboard_view_as_user";
export const VIEW_AS_COOKIE = "aap_view_as_user";

export function getDashboardViewAs() {
  if (typeof window === "undefined") return "super_admin";
  const saved = window.localStorage.getItem(VIEW_AS_KEY);
  return saved === "supervisor" || saved === "caller" ? saved : "super_admin";
}

// The impersonated caller { id, name } | null.
export function getViewAsUser() {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(window.localStorage.getItem(VIEW_AS_USER_KEY) || "null"); }
  catch { return null; }
}

// Persist (or clear) the impersonated caller — updates both localStorage (UI)
// and the cookie (server). Pass null to stop impersonating.
export function setViewAsUser(user) {
  if (typeof window === "undefined") return;
  if (user && user.id) {
    window.localStorage.setItem(VIEW_AS_USER_KEY, JSON.stringify({ id: user.id, name: user.username || user.name || `Caller ${user.id}` }));
    document.cookie = `${VIEW_AS_COOKIE}=${user.id}; path=/; max-age=86400; samesite=lax`;
  } else {
    window.localStorage.removeItem(VIEW_AS_USER_KEY);
    document.cookie = `${VIEW_AS_COOKIE}=; path=/; max-age=0; samesite=lax`;
  }
}
