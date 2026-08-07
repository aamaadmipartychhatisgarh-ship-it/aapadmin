"use client";

import { useSession, signOut } from "next-auth/react";
import { LayoutDashboard, Bell, Search, LogOut, PhoneCall, Database, Settings, Phone, Calendar, User, Download, PhoneOutgoing, MapPin, MessageSquare, AlertCircle, TrendingUp, FileText, Headphones, BarChart3, UserCog, UserCheck, ClipboardList, Gauge, Trophy, GraduationCap, Share2, Newspaper, Menu, X, CalendarClock, Shield, Flag, Users, Check } from "lucide-react";
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
  { name: "Social Media", href: "/dashboard/social", icon: Share2 },
  { name: "Social Command", href: "/dashboard/social-management", icon: Share2 },
];

// The Supervisor and Caller nav arrays — module-level (not session-derived)
// so both the real role AND a Super Admin's "Quick Dashboard Switch" preview
// (see VIEW_OPTIONS / viewAs below) render the IDENTICAL list, not a
// re-derived approximation of it.
const SUPERVISOR_NAV = [
  { name: "Overview", href: "/dashboard/supervisor", icon: LayoutDashboard },
  { name: "Contacts", href: "/dashboard/supervisor/contacts", icon: UserCheck },
  { name: "Analytics", href: "/dashboard/analytics", icon: BarChart3 },
  { name: "Caller Performance", href: "/dashboard/supervisor/callers", icon: TrendingUp },
  { name: "Teams", href: "/dashboard/admin/administration?tab=teams", icon: UserCog },
  { name: "Wrong Numbers", href: "/dashboard/admin/wrong-numbers", icon: AlertCircle },
  { name: "Area Reports", href: "/dashboard/supervisor/areas", icon: MapPin },
  { name: "Tasks", href: "/dashboard/tasks", icon: ClipboardList },
  { name: "Sentiment", href: "/dashboard/supervisor/sentiment", icon: MessageSquare },
  { name: "Follow-Ups", href: "/dashboard/supervisor/follow-ups", icon: PhoneCall },
  { name: "Remarks", href: "/dashboard/supervisor/remarks", icon: FileText },
  { name: "Media", href: "/dashboard/media", icon: Newspaper },
  { name: "Social Media", href: "/dashboard/social", icon: Share2 },
  { name: "Reports", href: "/dashboard/reports", icon: FileText },
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
  const [callers, setCallers] = useState([]);
  const [callerSubmenuOpen, setCallerSubmenuOpen] = useState(false);
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
  // Load the caller list for the Super Admin's "Caller Dashboard" submenu.
  useEffect(() => {
    if (normalizeRole(session?.user?.role) !== ROLES.SUPER_ADMIN) return;
    fetch("/api/users")
      .then((r) => r.json())
      .then((d) => setCallers((d.users || []).filter((u) => normalizeRole(u.role) === ROLES.CALLER)))
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
      { name: "Wrong Numbers", href: "/dashboard/admin/wrong-numbers", icon: AlertCircle },
      { name: "Call Records", href: "/dashboard/admin/calls", icon: Database },
      { name: "Caller Report", href: "/dashboard/admin/caller-report", icon: TrendingUp },
      { name: "Tasks", href: "/dashboard/tasks", icon: ClipboardList },
      { name: "Events", href: "/dashboard/admin/events", icon: CalendarClock },
      { name: "Complaints", href: "/dashboard/admin/complaints", icon: MessageSquare },
      { name: "Social Media", href: "/dashboard/social", icon: Share2 },
      { name: "Social Command", href: "/dashboard/social-management", icon: Share2 },
      { name: "Media", href: "/dashboard/media", icon: Newspaper },
      { name: "Reports", href: "/dashboard/reports", icon: FileText },
      { name: "Audit Logs", href: "/dashboard/admin/audit", icon: Shield },
    ],
    [ROLES.STATE_ADMIN]: [
      // Same as super_admin except no Users management
      { name: "Dashboard", href: "/dashboard/admin", icon: LayoutDashboard },
      { name: "Administration", href: "/dashboard/admin/administration", icon: UserCog },
      { name: "Contacts", href: "/dashboard/admin/contacts", icon: UserCheck },
      { name: "Wrong Numbers", href: "/dashboard/admin/wrong-numbers", icon: AlertCircle },
      { name: "Number Corrections", href: "/dashboard/admin/number-corrections", icon: Flag },
      { name: "Call Records", href: "/dashboard/admin/calls", icon: Database },
      { name: "Caller Report", href: "/dashboard/admin/caller-report", icon: TrendingUp },
      { name: "Tasks", href: "/dashboard/tasks", icon: ClipboardList },
      { name: "Complaints", href: "/dashboard/admin/complaints", icon: MessageSquare },
      { name: "Strength", href: "/dashboard/strength", icon: Gauge },
      { name: "Rankings", href: "/dashboard/rankings", icon: Trophy },
      { name: "Social Media", href: "/dashboard/social", icon: Share2 },
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
      { name: "Wrong Numbers", href: "/dashboard/admin/wrong-numbers", icon: AlertCircle },
      { name: "Number Corrections", href: "/dashboard/admin/number-corrections", icon: Flag },
      { name: "Call Records", href: "/dashboard/admin/calls", icon: Database },
      { name: "Caller Report", href: "/dashboard/admin/caller-report", icon: TrendingUp },
      { name: "Tasks", href: "/dashboard/tasks", icon: ClipboardList },
      { name: "Complaints", href: "/dashboard/admin/complaints", icon: MessageSquare },
      { name: "Strength", href: "/dashboard/strength", icon: Gauge },
      { name: "Rankings", href: "/dashboard/rankings", icon: Trophy },
      { name: "Social Media", href: "/dashboard/social", icon: Share2 },
      { name: "Reports", href: "/dashboard/reports", icon: FileText },
    ],
    [ROLES.DISTRICT_ADMIN]: [
      // District admin: focused on field ops within one district
      { name: "Dashboard", href: "/dashboard/admin", icon: LayoutDashboard },
      { name: "Administration", href: "/dashboard/admin/administration", icon: UserCog },
      { name: "Contacts", href: "/dashboard/admin/contacts", icon: UserCheck },
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
  } else if (canonical === ROLES.SOCIAL_MEDIA) {
    // Social media staff: war room + command center.
    navItems = [
      { name: "Social Media", href: "/dashboard/social", icon: Share2 },
      { name: "Social Command", href: "/dashboard/social-management", icon: Share2 },
      { name: "My Tasks", href: "/dashboard/tasks", icon: ClipboardList },
    ];
  } else {
    // Caller (and legacy 'user'/'agent') — the calling workspace
    navItems = CALLER_NAV;
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

  return (
    <div className="h-screen w-full flex overflow-hidden font-sans bg-[#f4f6f8]">
      <Heartbeat />
      <TaskNotifier />

      {/* Mobile drawer overlay */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Sidebar — off-canvas drawer on mobile, fixed and always expanded on
          desktop. Text labels for every role, no accordion. Admins see a
          SHORT list (one primary page per section — see primaryItems); the
          rest of each section is reachable from that primary page's header
          (SectionTabs), not listed again here. */}
      <aside
        className={`w-[260px] flex-shrink-0 flex flex-col h-full bg-[#0B3A82] text-white
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
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        
        {/* Header */}
        <header className="bg-white h-[72px] lg:h-[100px] flex items-center justify-between gap-2 px-3 lg:px-8 border-b border-gray-200 shrink-0 shadow-sm z-10">
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
                      const Icon = opt.icon;
                      const active = viewAs === opt.key;
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
                              <Icon size={15} className="shrink-0" />
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
                                      className={`flex w-full items-center gap-2 pl-10 pr-3.5 py-1.5 text-sm text-left ${on ? "text-[#164FA3] font-semibold bg-blue-50" : "text-gray-600 hover:bg-gray-100"}`}
                                    >
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
                          <Icon size={15} className="shrink-0" />
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
          <div className="flex items-center justify-center gap-2 bg-amber-50 border-b border-amber-200 px-4 py-1.5 text-xs sm:text-sm text-amber-800 shrink-0">
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
        <SectionTabs items={navItems} pathname={pathname} />

        {/* Scrollable Main Content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-8 relative">
          {children}
        </main>

        {/* Footer */}
        <footer className="bg-[#0B3A82] text-white py-3 px-4 lg:px-8 text-xs lg:text-[13px] flex flex-col sm:flex-row gap-1 sm:gap-0 justify-between items-center shrink-0 text-center">
          <div className="font-medium text-blue-100">Aam Aadmi Party, Chhattisgarh | Honest Politics, Better Chhattisgarh</div>
          <div className="text-blue-200">© {new Date().getFullYear()} Aam Aadmi Party Chhattisgarh</div>
        </footer>

      </div>
      
    </div>
  );
}
