"use client";

import { useSession, signOut } from "next-auth/react";
import { LayoutDashboard, Bell, Search, LogOut, PhoneCall, Database, Settings, Phone, Calendar, User, Download, PhoneOutgoing, MapPin, MessageSquare, AlertCircle, TrendingUp, FileText, Headphones, UserCog, UserCheck, ClipboardList, Gauge, Trophy, GraduationCap, Share2, Newspaper, Menu, X, CalendarClock, Shield, Flag, Users, Check, BarChart3, Lock, Loader2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import Heartbeat from "@/components/Heartbeat";
import Avatar from "@/components/Avatar";
import InstallApp from "@/components/InstallApp";
import ThemeToggle from "@/components/ThemeToggle";
import TaskNotifier from "@/components/TaskNotifier";
import SidebarNav from "@/components/SidebarNav";
import SectionTabs from "@/components/SectionTabs";
import FloatingPopover from "@/components/FloatingPopover";
import { isAdmin, isSupervisorRole, roleLabel, normalizeRole, ROLES } from "@/lib/permissions";
import { primaryItems } from "@/lib/navGroups";
import { PAGES, pageKeyForPath } from "@/lib/pages";
import { usePageAccess } from "@/components/usePageAccess";
import { VIEW_AS_KEY, getDashboardViewAs, getViewAsUser, setViewAsUser } from "@/lib/dashboardView";

async function handleSignOut() {
  try {
    await fetch("/api/logout-mark", { method: "POST" });
  } catch {}
  signOut();
}

// Super admin only: plain quick-links, unrelated to the role preview below
// (Super Admin already has its own full nav; these just save a couple of
// clicks to tools outside that nav).
const DASHBOARD_SWITCHER = [
  { name: "My Profile", href: "/dashboard/profile", icon: User },
  { name: "Media Center", href: "/dashboard/media", icon: Newspaper },
  { name: "Social Command", href: "/dashboard/social-management", icon: Share2 },
];

// The Supervisor and Caller nav arrays — module-level (not session-derived)
// so both the real role AND a Super Admin's "Quick Dashboard Switch" preview
// (see VIEW_OPTIONS / viewAs below) render the IDENTICAL list, not a
// re-derived approximation of it.
const SUPERVISOR_NAV = [
  { name: "Overview", href: "/dashboard/supervisor", icon: LayoutDashboard },
  // Contacts is a collapsible parent — Follow-Ups, Remarks and Wrong Numbers
  // are nested beneath it as child pages (supervisor dashboard only). Their
  // routes/pages are unchanged; only the sidebar grouping moved.
  {
    name: "Contacts",
    href: "/dashboard/supervisor/contacts",
    icon: UserCheck,
    children: [
      { name: "Follow-Ups", href: "/dashboard/supervisor/follow-ups", icon: PhoneCall },
      { name: "Remarks", href: "/dashboard/supervisor/remarks", icon: FileText },
      { name: "Wrong Numbers", href: "/dashboard/admin/wrong-numbers", icon: AlertCircle },
    ],
  },
  { name: "Tasks", href: "/dashboard/tasks", icon: ClipboardList },
  { name: "Leader Assessment", href: "/dashboard/leader-assessment", icon: Gauge },
  { name: "Media", href: "/dashboard/media", icon: Newspaper },
  // Reports is a collapsible parent — Area Reports is nested beneath it as a
  // child page (supervisor dashboard only). Analytics is intentionally NOT
  // listed here (removed from the supervisor sidebar); its page/route/API stay
  // intact and reachable directly, just not shown in this nav.
  {
    name: "Reports",
    href: "/dashboard/reports",
    icon: FileText,
    children: [
      { name: "Area Reports", href: "/dashboard/supervisor/areas", icon: MapPin },
    ],
  },
];
const CALLER_NAV = [
  { name: "My Workspace", href: "/dashboard/workspace", icon: Headphones },
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Log a Call", href: "/dashboard/calls/new", icon: PhoneCall },
  { name: "My Calls", href: "/dashboard/calls", icon: Database },
  { name: "Complaints", href: "/dashboard/complaints", icon: MessageSquare },
  { name: "My Tasks", href: "/dashboard/tasks", icon: ClipboardList },
  // The Not Interested tab of the Wrong Numbers dashboard, scoped to this caller.
  { name: "Not Interested", href: "/dashboard/admin/wrong-numbers", icon: AlertCircle },
];

// Quick Dashboard Switch — Super Admin only. Sets which nav/layout renders
// (see `viewAs` below) and jumps straight to that role's home page. This
// changes ONLY navigation/layout chrome — the signed-in session, and every
// page's own server-side permission check, are completely untouched; a
// Super Admin previewing Supervisor/Caller still has full Super Admin
// backend access (see the two known, deliberate exceptions noted where
// `viewAs` is read: workspace/page.js's oversight-redirect bypass, and
// supervisor/contacts/page.js's preview notice, neither of which grants any
// NEW privilege — both just avoid bouncing an already-fully-privileged user
// away from a page they're allowed to look at).
const VIEW_OPTIONS = [
  { key: "super_admin", name: "Super Admin Dashboard", homeHref: "/dashboard/admin", icon: Shield },
  { key: "supervisor", name: "Supervisor Dashboard", homeHref: "/dashboard/supervisor", icon: Users },
  { key: "caller", name: "Caller Dashboard", homeHref: "/dashboard/workspace", icon: Headphones },
];

// Maps a page-registry icon name (see src/lib/pages.js) to its lucide component,
// so a page GRANTED to a user can be appended to their sidebar with the right
// icon. Any unmapped name falls back to a generic file icon.
const PAGE_ICONS = {
  LayoutDashboard, Headphones, Database, UserCheck, AlertCircle, TrendingUp,
  MessageSquare, ClipboardList, Gauge, Newspaper, Share2, FileText, BarChart3,
  Trophy, CalendarClock, Flag, UserCog, GraduationCap,
};

export default function DashboardLayout({ children }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [dashboardSwitcherOpen, setDashboardSwitcherOpen] = useState(false);
  const switcherBtnRef = useRef(null);
  // Quick Dashboard Switch — which role's nav/layout to render (Super Admin
  // only; see VIEW_OPTIONS above). Persisted so a refresh keeps the preview
  // active instead of silently dropping back to the real role's own view.
  const [viewAs, setViewAsState] = useState("super_admin");
  // The specific caller a Super Admin is impersonating (Caller Dashboard
  // submenu), the caller list to choose from, and the submenu's open state.
  const [viewAsUser, setVAUser] = useState(null);
  // Full user list (Super Admin only) — each row carries photo_url so the
  // dashboard switcher can render every option against its OWN user's photo.
  const [allUsers, setAllUsers] = useState([]);
  const callers = allUsers.filter((u) => normalizeRole(u.role) === ROLES.CALLER);
  // The supervisor account whose photo represents the "Supervisor Dashboard"
  // view option. Resolved from real user data (not a hardcoded username); null
  // → the Avatar falls back to a clean default DP.
  const supervisorUser = allUsers.find((u) => normalizeRole(u.role) === ROLES.SUPERVISOR) || null;
  const [callerSubmenuOpen, setCallerSubmenuOpen] = useState(false);
  // Effective page access for the signed-in user (baseline role pages ∪ any
  // Super-Admin-granted pages) — the same source the backend and page guards
  // use, so a GRANTED page shows up in this user's sidebar (BUG 14).
  const { pages: allowedPageKeys, restricted: pageRestricted } = usePageAccess();
  useEffect(() => {
    setViewAsState(getDashboardViewAs());
    setVAUser(getViewAsUser());
  }, []);
  function setViewAs(v) {
    setViewAsState(v);
    if (typeof window !== "undefined") window.localStorage.setItem(VIEW_AS_KEY, v);
    // Leaving the Caller view (or switching to a non-caller view) stops
    // impersonating whichever caller was selected.
    if (v !== "caller") { setViewAsUser(null); setVAUser(null); }
  }
  // Pick a specific caller to act as, then jump to their workspace.
  function pickCaller(c) {
    setViewAsState("caller");
    if (typeof window !== "undefined") window.localStorage.setItem(VIEW_AS_KEY, "caller");
    setViewAsUser(c);
    setVAUser({ id: c.id, name: c.username });
    setCallerSubmenuOpen(false);
    setDashboardSwitcherOpen(false);
    router.push("/dashboard/workspace");
  }

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Page Access route gate is enforced by RENDER-BLOCKING below (accessBlocked +
  // <AccessDenied/>), not a redirect — so an unauthorized page is never rendered
  // for a page-restricted user, even for a frame. Backend/API checks enforce the
  // identical limit. pageRestricted is always false for Super Admins and for
  // unmanaged users, so neither previews nor normal role users are affected.
  // Load the caller list for the Super Admin's "Caller Dashboard" submenu.
  useEffect(() => {
    if (normalizeRole(session?.user?.role) !== ROLES.SUPER_ADMIN) return;
    fetch("/api/users")
      .then((r) => r.json())
      .then((d) => setAllUsers(d.users || []))
      .catch(() => {});
  }, [session]);
  // App version — injected at build time from package.json.
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || "";

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status === "loading" || status === "unauthenticated") {
    return <div className="min-h-screen bg-[#0B3A82] flex items-center justify-center text-white">Loading...</div>;
  }

  if (!session) {
    return <div className="min-h-screen bg-[#0B3A82] flex items-center justify-center text-white">Loading...</div>;
  }

  const role = session.user.role;
  const canonical = normalizeRole(role);
  const isUserAdmin = isAdmin(session);
  const isSupervisor = isSupervisorRole(session);

  // Per-admin-tier menu items. Higher tiers include more, lower tiers are
  // trimmed to operational tools relevant to their scope.
  const ADMIN_MENUS = {
    [ROLES.SUPER_ADMIN]: [
      { name: "Dashboard", href: "/dashboard/admin", icon: LayoutDashboard },
      { name: "Administration", href: "/dashboard/admin/administration", icon: UserCog },
      { name: "Contacts", href: "/dashboard/admin/contacts", icon: UserCheck },
      { name: "Incomplete Designation", href: "/dashboard/admin/contacts-incomplete", icon: AlertCircle },
      { name: "Wrong Numbers", href: "/dashboard/admin/wrong-numbers", icon: AlertCircle },
      { name: "Call Records", href: "/dashboard/admin/calls", icon: Database },
      { name: "Caller Report", href: "/dashboard/admin/caller-report", icon: TrendingUp },
      { name: "Tasks", href: "/dashboard/tasks", icon: ClipboardList },
      { name: "Leader Assessment", href: "/dashboard/leader-assessment", icon: Gauge },
      { name: "Events", href: "/dashboard/admin/events", icon: CalendarClock },
      { name: "Complaints", href: "/dashboard/admin/complaints", icon: MessageSquare },
      { name: "Social Command", href: "/dashboard/social-management", icon: Share2 },
      { name: "Media", href: "/dashboard/media", icon: Newspaper },
      { name: "Reports", href: "/dashboard/reports", icon: FileText },
    ],
    [ROLES.STATE_ADMIN]: [
      // Same as super_admin except no Users management
      { name: "Dashboard", href: "/dashboard/admin", icon: LayoutDashboard },
      { name: "Administration", href: "/dashboard/admin/administration", icon: UserCog },
      { name: "Contacts", href: "/dashboard/admin/contacts", icon: UserCheck },
      { name: "Incomplete Designation", href: "/dashboard/admin/contacts-incomplete", icon: AlertCircle },
      { name: "Wrong Numbers", href: "/dashboard/admin/wrong-numbers", icon: AlertCircle },
      { name: "Number Corrections", href: "/dashboard/admin/number-corrections", icon: Flag },
      { name: "Call Records", href: "/dashboard/admin/calls", icon: Database },
      { name: "Caller Report", href: "/dashboard/admin/caller-report", icon: TrendingUp },
      { name: "Tasks", href: "/dashboard/tasks", icon: ClipboardList },
      { name: "Complaints", href: "/dashboard/admin/complaints", icon: MessageSquare },
      { name: "Strength", href: "/dashboard/strength", icon: Gauge },
      { name: "Rankings", href: "/dashboard/rankings", icon: Trophy },
      { name: "Social Command", href: "/dashboard/social-management", icon: Share2 },
      { name: "Media", href: "/dashboard/media", icon: Newspaper },
      { name: "Reports", href: "/dashboard/reports", icon: FileText },
      { name: "Master Data", href: "/dashboard/admin/settings", icon: Settings },
    ],
    [ROLES.ZONE_ADMIN]: [
      // Zone admins manage zone operations; no Users, Master Data, or Social Command (state-level)
      { name: "Dashboard", href: "/dashboard/admin", icon: LayoutDashboard },
      { name: "Administration", href: "/dashboard/admin/administration", icon: UserCog },
      { name: "Contacts", href: "/dashboard/admin/contacts", icon: UserCheck },
      { name: "Incomplete Designation", href: "/dashboard/admin/contacts-incomplete", icon: AlertCircle },
      { name: "Wrong Numbers", href: "/dashboard/admin/wrong-numbers", icon: AlertCircle },
      { name: "Number Corrections", href: "/dashboard/admin/number-corrections", icon: Flag },
      { name: "Call Records", href: "/dashboard/admin/calls", icon: Database },
      { name: "Caller Report", href: "/dashboard/admin/caller-report", icon: TrendingUp },
      { name: "Tasks", href: "/dashboard/tasks", icon: ClipboardList },
      { name: "Complaints", href: "/dashboard/admin/complaints", icon: MessageSquare },
      { name: "Strength", href: "/dashboard/strength", icon: Gauge },
      { name: "Rankings", href: "/dashboard/rankings", icon: Trophy },
      { name: "Reports", href: "/dashboard/reports", icon: FileText },
    ],
    [ROLES.DISTRICT_ADMIN]: [
      // District admin: focused on field ops within one district
      { name: "Dashboard", href: "/dashboard/admin", icon: LayoutDashboard },
      { name: "Administration", href: "/dashboard/admin/administration", icon: UserCog },
      { name: "Contacts", href: "/dashboard/admin/contacts", icon: UserCheck },
      { name: "Incomplete Designation", href: "/dashboard/admin/contacts-incomplete", icon: AlertCircle },
      { name: "Wrong Numbers", href: "/dashboard/admin/wrong-numbers", icon: AlertCircle },
      { name: "Number Corrections", href: "/dashboard/admin/number-corrections", icon: Flag },
      { name: "Call Records", href: "/dashboard/admin/calls", icon: Database },
      { name: "Caller Report", href: "/dashboard/admin/caller-report", icon: TrendingUp },
      { name: "Tasks", href: "/dashboard/tasks", icon: ClipboardList },
      { name: "Complaints", href: "/dashboard/admin/complaints", icon: MessageSquare },
      { name: "Rankings", href: "/dashboard/rankings", icon: Trophy },
      { name: "Reports", href: "/dashboard/reports", icon: FileText },
    ],
    [ROLES.ASSEMBLY_ADMIN]: [
      // Assembly admin: very narrow — booth & ward management
      { name: "Dashboard", href: "/dashboard/admin", icon: LayoutDashboard },
      { name: "Administration", href: "/dashboard/admin/administration", icon: UserCog },
      { name: "Contacts", href: "/dashboard/admin/contacts", icon: UserCheck },
      { name: "Incomplete Designation", href: "/dashboard/admin/contacts-incomplete", icon: AlertCircle },
      { name: "Wrong Numbers", href: "/dashboard/admin/wrong-numbers", icon: AlertCircle },
      { name: "Number Corrections", href: "/dashboard/admin/number-corrections", icon: Flag },
      { name: "Tasks", href: "/dashboard/tasks", icon: ClipboardList },
      { name: "Complaints", href: "/dashboard/admin/complaints", icon: MessageSquare },
    ],
  };

  // A Super Admin previewing another role's dashboard (Quick Dashboard
  // Switch) gets that role's exact nav array — same constants a REAL
  // Supervisor/Caller renders below, so "preview" can never drift from the
  // genuine article.
  const isSuper = canonical === ROLES.SUPER_ADMIN;
  const previewing = isSuper && viewAs !== "super_admin";

  let navItems;
  if (previewing && viewAs === "supervisor") {
    navItems = SUPERVISOR_NAV;
  } else if (previewing && viewAs === "caller") {
    navItems = CALLER_NAV;
  } else if (isUserAdmin) {
    navItems = ADMIN_MENUS[canonical] || ADMIN_MENUS[ROLES.SUPER_ADMIN];
  } else if (isSupervisor) {
    navItems = SUPERVISOR_NAV;
  } else if (canonical === ROLES.WORKER) {
    // Workers: org members on the ground. No calling UI.
    navItems = [
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { name: "My Tasks", href: "/dashboard/tasks", icon: ClipboardList },
    ];
  } else if (canonical === ROLES.PRESS_MEDIA) {
    // Press media staff: the Media Center is their workspace.
    navItems = [
      { name: "Media", href: "/dashboard/media", icon: Newspaper },
      { name: "My Tasks", href: "/dashboard/tasks", icon: ClipboardList },
    ];
  } else if (canonical === ROLES.MEDIA_USER) {
    // Media User (§9.3): ONLY the Media Center — no Contacts, Leader Assessment,
    // Administration, Reports or Tasks. Backend APIs enforce the same limit.
    navItems = [
      { name: "Media", href: "/dashboard/media", icon: Newspaper },
    ];
  } else if (canonical === ROLES.SOCIAL_MEDIA) {
    // Social media staff: the Social Command centre (the standalone "Social
    // Media" war-room page was removed — BUG 17).
    navItems = [
      { name: "Social Command", href: "/dashboard/social-management", icon: Share2 },
      { name: "My Tasks", href: "/dashboard/tasks", icon: ClipboardList },
    ];
  } else {
    // Caller (and legacy 'user'/'agent') — the calling workspace
    navItems = CALLER_NAV;
  }

  // Page Access OVERRIDE — a page-restricted user (one the Super Admin has
  // assigned specific pages to) gets a sidebar of EXACTLY those pages, nothing
  // role-derived. Assigning "Page A" therefore shows only Page A; My Calls /
  // Workspace / Contacts / Reports etc. never appear. Non-restricted users keep
  // their normal role nav. Skipped while previewing another role.
  if (!previewing && pageRestricted && allowedPageKeys) {
    // Skip `tab: true` sub-pages — they are in-page tabs (Media / Social / Leader
    // Assessment sections), not separate destinations. Their PARENT container
    // (added to the effective set when a child is granted) is the one nav item;
    // which tabs show inside it is enforced by that page. De-dup by href so a
    // parent granted alongside its children still yields one entry.
    const seen = new Set();
    navItems = allowedPageKeys
      .map((key) => PAGES.find((p) => p.key === key))
      .filter((pg) => pg && !pg.tab)
      .filter((pg) => (seen.has(pg.href) ? false : (seen.add(pg.href), true)))
      .map((pg) => ({ name: pg.label, href: pg.href, icon: PAGE_ICONS[pg.icon] || FileText }));
  }

  // Every role gets a profile link — appended once here instead of in each
  // branch above. It's not part of any navGroups.js GROUPS entry, so
  // primaryItems() (which shortens the admin sidebar) keeps it as-is.
  navItems = [...navItems, { name: "My Profile", href: "/dashboard/profile", icon: User }];

  // Filter nav items for the header search bar. Search still covers every
  // page (not just the shortened sidebar list) so nothing becomes unreachable.
  const q = searchQuery.trim().toLowerCase();
  const searchResults = q
    ? navItems.filter((item) => item.name.toLowerCase().includes(q))
    : [];

  // Admins get a short sidebar (one primary page per section); other roles
  // keep their full list as-is (already short, no accordion/grouping to trim).
  // A previewing Super Admin uses the FULL list too — primaryItems() only
  // makes sense for the admin's own grouped nav (navGroups.js), and applying
  // it to a Supervisor/Caller preview would trim it into something a real
  // Supervisor/Caller never sees.
  const sidebarItems = (isUserAdmin && !previewing) ? primaryItems(navItems) : navItems;

  // Supervisor Reports section: hide the "Reports" and "Remarks" cross-link
  // tabs from the SectionTabs header row. Both stay reachable — Reports from
  // the sidebar, Remarks under the Contacts submenu — and their pages/routes
  // are untouched. Scoped to the supervisor view only, so Super Admin's own
  // SectionTabs (and every other role's) are unchanged. sidebarItems is a
  // separate list, so the Reports sidebar menu item is unaffected.
  const inSupervisorView = isSupervisor || (previewing && viewAs === "supervisor");
  const HIDE_SUPERVISOR_TABS = new Set(["/dashboard/reports", "/dashboard/supervisor/remarks"]);
  const sectionTabItems = inSupervisorView
    ? navItems.filter((i) => !HIDE_SUPERVISOR_TABS.has(i.href))
    : navItems;

  // Page Access ENFORCEMENT (client half). For a page-restricted (managed) user,
  // resolve the current path to its page key and block the render entirely when
  // that key is not in their assigned set — the unauthorized page never mounts.
  // Super Admins and unmanaged users have pageRestricted=false, so this is inert
  // for them (their existing role behaviour is untouched, §8). Ungated/utility
  // paths (profile, admin hub) resolve to a null key and are always allowed.
  const currentPageKey = pageKeyForPath(pathname);
  const accessBlocked =
    !previewing && pageRestricted && Array.isArray(allowedPageKeys) &&
    !!currentPageKey && !allowedPageKeys.includes(currentPageKey);
  const firstAllowedPage = (allowedPageKeys || [])
    .map((k) => PAGES.find((p) => p.key === k)).find(Boolean);
  const accessFallbackHref = firstAllowedPage?.href || "/dashboard/profile";

  // PERMISSIONS-LOADING GATE — for a non-Super-Admin (and not while a Super Admin
  // previews another role), do NOT render the app shell until /api/my-pages has
  // resolved this user's exact page set. Without this, the role-based `navItems`
  // built above would show for a moment (or persist if the fetch is slow/failed),
  // which is exactly the "old/default pages still appear" bug: a Caller assigned
  // only Social Command would briefly see their old Caller nav. usePageAccess is
  // fail-closed (it retries and never yields role defaults), so `allowedPageKeys`
  // is null ONLY while genuinely loading — we show a spinner, never stale pages.
  const isSuperUser = canonical === ROLES.SUPER_ADMIN;
  if (!isSuperUser && !previewing && allowedPageKeys === null) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[#f4f6f8]">
        <Loader2 className="animate-spin text-[#164FA3]" size={28} />
      </div>
    );
  }

  // ZERO-ACCESS STATE — a page-restricted user (every normal user; a managed
  // oversight user) whose assigned-page set is EMPTY. They have no pages at all,
  // so the entire application shell (sidebar, top bar, navigation, dashboard) is
  // suppressed and ONLY a clear "not allotted any page" screen is shown. Guarded
  // on allowedPageKeys being a loaded array (null while loading) so it never
  // flashes during the permission fetch. A previewing Super Admin is exempt.
  const noAccess =
    !previewing && pageRestricted && Array.isArray(allowedPageKeys) && allowedPageKeys.length === 0;
  if (noAccess) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#f4f6f8] px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-[#164FA3]/10 text-[#164FA3] flex items-center justify-center mb-5">
          <Lock size={30} />
        </div>
        <h1 className="text-xl font-bold text-gray-900">You have not been allotted any page.</h1>
        <p className="text-gray-500 mt-2 max-w-md text-sm">
          Your account does not have access to any page yet. Please contact your administrator to be assigned the pages you need.
        </p>
        <button
          onClick={handleSignOut}
          className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-gray-200 text-gray-700 hover:bg-gray-100"
        >
          <LogOut size={16} /> Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="print-shell h-screen w-full flex overflow-hidden font-sans bg-[#f4f6f8]">
      <Heartbeat />
      <TaskNotifier />

      {/* Mobile drawer overlay */}
      {mobileNavOpen && (
        <div
          className="no-print fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Sidebar — off-canvas drawer on mobile, fixed and always expanded on
          desktop. Text labels for every role, no accordion. Admins see a
          SHORT list (one primary page per section — see primaryItems); the
          rest of each section is reachable from that primary page's header
          (SectionTabs), not listed again here. */}
      <aside
        className={`no-print w-[260px] flex-shrink-0 flex flex-col h-full bg-[#0B3A82] text-white
          fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 lg:static lg:transform-none
          ${mobileNavOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        {/* Close button (mobile only) */}
        <button
          onClick={() => setMobileNavOpen(false)}
          className="lg:hidden absolute top-3 right-3 text-blue-200 hover:text-white p-1"
          aria-label="Close menu"
        >
          <X size={22} />
        </button>

        {/* Logo */}
        <div className="flex flex-col items-center py-6 border-b border-white/10">
          <img src="/aap_logo.jpg" alt="AAP Logo" className="w-20 h-20 object-contain mb-2 rounded-full border-2 border-white/20 bg-white" />
          <div className="text-base mt-2 font-medium">Chhattisgarh</div>
        </div>

        {/* Navigation */}
        <SidebarNav items={sidebarItems} pathname={pathname} onNavigate={() => setMobileNavOpen(false)} />

        {/* Bottom Area */}
        <div className="p-4 mt-auto space-y-1">
          <InstallApp variant="sidebar" />
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-4 py-2.5 rounded-md text-blue-200 hover:text-white hover:bg-white/10 w-full transition-all text-sm"
          >
            <LogOut size={18} />
            <span>Sign out</span>
          </button>
          {appVersion && (
            <div className="pt-2 text-center text-[11px] text-blue-300/70">
              Version {appVersion}
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="print-col flex-1 flex flex-col h-full overflow-hidden">

        {/* Header */}
        <header className="no-print bg-white h-[72px] lg:h-[100px] flex items-center justify-between gap-2 px-3 lg:px-8 border-b border-gray-200 shrink-0 shadow-sm z-10">
          {/* Header Left - Organization Info */}
          <div className="flex items-center gap-2 lg:gap-5 min-w-0">
            {/* Hamburger (mobile only) */}
            <button
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden text-[#0B3A82] p-1 shrink-0"
              aria-label="Open menu"
            >
              <Menu size={26} />
            </button>
            <div className="hidden sm:flex w-[60px] h-[60px] lg:w-[100px] lg:h-[100px] items-center justify-center shrink-0 lg:-mt-2">
              <img
                src="/kejriwal_new.png"
                alt="Arvind Kejriwal"
                className="leader-photo w-full h-full object-contain scale-125 mix-blend-multiply drop-shadow-sm"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.parentElement.innerHTML = '<span class="text-gray-400 font-bold text-xl">AK</span>';
                }}
              />
            </div>
            <div className="flex flex-col justify-center min-w-0">
              <h1 className="text-base lg:text-[28px] font-bold text-[#0B3A82] leading-tight truncate">Aam Aadmi Party, Chhattisgarh</h1>
              <p className="hidden sm:block text-xs lg:text-[15px] text-gray-600 mt-0.5 font-medium truncate">Honest Politics | Better Chhattisgarh</p>
            </div>
          </div>

          {/* Header Center - Search (hidden on small screens) */}
          <div className="hidden md:block flex-1 max-w-md mx-4 lg:mx-8 relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              placeholder="Search pages…"
              className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0B3A82]/30 focus:border-[#0B3A82]"
            />
            {searchOpen && searchQuery.trim() && (
              <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-20 max-h-72 overflow-y-auto">
                {searchResults.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-400">No matches</div>
                ) : (
                  searchResults.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.href}
                        onMouseDown={() => { router.push(item.href); setSearchQuery(""); setSearchOpen(false); }}
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Icon size={16} className="text-[#0B3A82]" />
                        <span>{item.name}</span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Header Right - User */}
          <div className="flex items-center gap-4 shrink-0">
            <ThemeToggle />
            {canonical === ROLES.SUPER_ADMIN ? (
              <>
                <button
                  ref={switcherBtnRef}
                  onClick={() => setDashboardSwitcherOpen((o) => !o)}
                  aria-expanded={dashboardSwitcherOpen}
                  title="Switch dashboard"
                  className="flex items-center gap-3 lg:pl-4 rounded-lg hover:bg-gray-50 py-1 pr-1"
                >
                  <Avatar name={session.user.name} src={session.user.photo_url} size={40} className="bg-blue-50 border border-blue-100" textClassName="text-[#0B3A82]" />
                  <div className="hidden sm:flex text-left flex-col justify-center mr-2 min-w-0 max-w-[140px]">
                    <div className="text-sm font-bold text-gray-900 leading-tight truncate">
                      {session.user.name}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">
                      {roleLabel(role)}
                    </div>
                  </div>
                  <span className={`hidden sm:inline text-gray-400 transition-transform ${dashboardSwitcherOpen ? "rotate-180" : ""}`}>▼</span>
                </button>
                <FloatingPopover
                  anchorRef={switcherBtnRef}
                  open={dashboardSwitcherOpen}
                  onClose={() => setDashboardSwitcherOpen(false)}
                  width={256}
                  estimatedHeight={(VIEW_OPTIONS.length + DASHBOARD_SWITCHER.length) * 36 + 80}
                >
                  <div className="py-1.5 max-h-[80vh] overflow-y-auto">
                    <div className="px-3.5 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Quick Dashboard Switch</div>
                    {VIEW_OPTIONS.map((opt) => {
                      const active = viewAs === opt.key;
                      // Resolve each dashboard option's avatar against its OWN
                      // user's photo (never a shared/hardcoded image): the
                      // Super Admin option → the signed-in super admin; the
                      // Supervisor option → the real supervisor account; the
                      // Caller option → the caller currently being previewed.
                      // A missing photo → Avatar's clean default DP.
                      const impCaller = callers.find((c) => String(c.id) === String(viewAsUser?.id));
                      const optAvatar =
                        opt.key === "super_admin" ? { name: session.user.name, src: session.user.photo_url }
                        : opt.key === "supervisor" ? { name: supervisorUser?.username || "Supervisor", src: supervisorUser?.photo_url }
                        : { name: (active && viewAsUser?.name) || "Caller", src: (active && impCaller?.photo_url) || null };
                      // Caller Dashboard expands into a submenu of caller profiles
                      // instead of opening a dashboard directly.
                      if (opt.key === "caller") {
                        return (
                          <div key={opt.key}>
                            <button
                              type="button"
                              onClick={() => setCallerSubmenuOpen((o) => !o)}
                              className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-left ${active ? "bg-blue-50 text-[#164FA3] font-semibold" : "text-gray-700 hover:bg-gray-50"}`}
                            >
                              <Avatar name={optAvatar.name} src={optAvatar.src} size={24} className="border border-gray-200 bg-gray-50" textClassName="text-[#0B3A82]" />
                              <span className="flex-1">{opt.name}</span>
                              {active && viewAsUser && <span className="text-xs text-[#164FA3] truncate max-w-[70px]">{viewAsUser.name}</span>}
                              <span className={`text-gray-400 text-[10px] transition-transform ${callerSubmenuOpen ? "rotate-90" : ""}`}>▶</span>
                            </button>
                            {callerSubmenuOpen && (
                              <div className="bg-gray-50/70 border-y border-gray-100">
                                {callers.length === 0 ? (
                                  <div className="pl-10 pr-3.5 py-2 text-xs text-gray-400">No caller profiles found.</div>
                                ) : callers.map((c) => {
                                  const on = active && String(viewAsUser?.id) === String(c.id);
                                  return (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() => pickCaller(c)}
                                      className={`flex w-full items-center gap-2 pl-6 pr-3.5 py-1.5 text-sm text-left ${on ? "text-[#164FA3] font-semibold bg-blue-50" : "text-gray-600 hover:bg-gray-100"}`}
                                    >
                                      <Avatar name={c.username} src={c.photo_url} size={22} className="border border-gray-200 bg-white" textClassName="text-[#0B3A82]" />
                                      <span className="flex-1 truncate">{c.username}</span>
                                      {on && <Check size={14} className="shrink-0 text-[#164FA3]" />}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      }
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => {
                            setViewAs(opt.key);
                            setDashboardSwitcherOpen(false);
                            router.push(opt.homeHref);
                          }}
                          className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-left ${active ? "bg-blue-50 text-[#164FA3] font-semibold" : "text-gray-700 hover:bg-gray-50"}`}
                        >
                          <Avatar name={optAvatar.name} src={optAvatar.src} size={24} className="border border-gray-200 bg-gray-50" textClassName="text-[#0B3A82]" />
                          <span className="flex-1">{opt.name}</span>
                          {active && <Check size={15} className="shrink-0 text-[#164FA3]" />}
                        </button>
                      );
                    })}
                    <div className="my-1.5 border-t border-gray-100" />
                    {DASHBOARD_SWITCHER.map((d) => {
                      const Icon = d.icon;
                      return (
                        <Link
                          key={d.href}
                          href={d.href}
                          onClick={() => setDashboardSwitcherOpen(false)}
                          className={`flex items-center gap-2.5 px-3.5 py-2 text-sm hover:bg-gray-50 ${pathname === d.href ? "text-[#164FA3] font-semibold" : "text-gray-700"}`}
                        >
                          <Icon size={15} /> {d.name}
                        </Link>
                      );
                    })}
                  </div>
                </FloatingPopover>
              </>
            ) : (
              <Link href="/dashboard/profile" title="My Profile" className="flex items-center gap-3 lg:pl-4 rounded-lg hover:bg-gray-50 py-1">
                <Avatar name={session.user.name} src={session.user.photo_url} size={40} className="bg-blue-50 border border-blue-100" textClassName="text-[#0B3A82]" />
                <div className="hidden sm:flex text-left flex-col justify-center mr-2 min-w-0 max-w-[140px]">
                  <div className="text-sm font-bold text-gray-900 leading-tight truncate">
                    {session.user.name}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 truncate">
                    {roleLabel(role)}
                  </div>
                </div>
              </Link>
            )}
          </div>
        </header>

        {/* Quick Dashboard Switch preview banner — only ever shown to the real
            Super Admin (viewAs is never set for other roles), so this can
            never be spoofed into claiming a lesser role has admin access. */}
        {previewing && (
          <div className="no-print flex items-center justify-center gap-2 bg-amber-50 border-b border-amber-200 px-4 py-1.5 text-xs sm:text-sm text-amber-800 shrink-0">
            <span>
              Current User: <strong>Super Admin</strong> &middot; Current View:{" "}
              <strong>
                {VIEW_OPTIONS.find((o) => o.key === viewAs)?.name}
                {viewAs === "caller" && viewAsUser ? ` — ${viewAsUser.name}` : ""}
              </strong>
            </span>
            <button
              type="button"
              onClick={() => {
                setViewAs("super_admin");
                router.push("/dashboard/admin");
              }}
              className="ml-1 font-semibold text-[#164FA3] hover:underline"
            >
              Back to Super Admin
            </button>
          </div>
        )}

        {/* Section tabs — sibling pages of the current section as plain text
            links (replaces what the old sidebar accordion used to reveal) */}
        <div className="no-print"><SectionTabs items={sectionTabItems} pathname={pathname} /></div>

        {/* Scrollable Main Content — a page-restricted user on an unassigned
            page gets a hard Access Denied screen instead of the page (the
            unauthorized page is never rendered). */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-8 relative">
          {accessBlocked ? <AccessDenied fallbackHref={accessFallbackHref} /> : children}
        </main>

        {/* Footer */}
        <footer className="no-print bg-[#0B3A82] text-white py-3 px-4 lg:px-8 text-xs lg:text-[13px] flex flex-col sm:flex-row gap-1 sm:gap-0 justify-between items-center shrink-0 text-center">
          <div className="font-medium text-blue-100">Aam Aadmi Party, Chhattisgarh | Honest Politics, Better Chhattisgarh</div>
          <div className="text-blue-200">© {new Date().getFullYear()} Aam Aadmi Party Chhattisgarh</div>
        </footer>

      </div>

    </div>
  );
}

// Shown in place of a page when a page-restricted user reaches a page they were
// not assigned. The page itself is never rendered — this replaces it — so both
// the sidebar (hidden item) and the route (this screen) enforce the same limit,
// alongside the backend/API 401/403 for the same page. A link takes them to
// their first assigned page (or profile if they have none).
function AccessDenied({ fallbackHref }) {
  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center">
      <div className="max-w-md w-full bg-white border border-gray-200 rounded-2xl shadow-sm p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4">
          <Shield size={26} />
        </div>
        <h2 className="text-lg font-bold text-gray-900">Access Denied</h2>
        <p className="text-sm text-gray-500 mt-2">
          You don’t have permission to view this page. Your access is limited to the pages assigned to you.
        </p>
        <Link
          href={fallbackHref}
          className="inline-flex items-center justify-center gap-2 mt-6 h-10 px-5 rounded-lg bg-[#164FA3] text-white text-sm font-semibold hover:bg-[#123f85]"
        >
          Go to an allowed page
        </Link>
      </div>
    </div>
  );
}
