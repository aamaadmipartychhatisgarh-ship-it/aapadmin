// Standalone entry point for the Worker & Membership PWA. This route sits OUTSIDE
// the /dashboard layout, so the installed app shows ONLY the Worker & Membership
// experience — no dashboard sidebar, no other modules (§23, §25). It still runs
// under the app-wide root layout (Providers → SessionProvider), so the existing
// Super Admin authentication and the same backend/database are used (§24, §26).
//
// The scoped web manifest (start_url/scope = /wm) is linked here, so installing
// from this route creates a dedicated "Worker & Membership" app.

export const metadata = {
  title: "Worker & Membership",
  manifest: "/wm.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Worker & Membership" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0B3A82",
};

export default function WmLayout({ children }) {
  return children;
}
