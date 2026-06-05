"use client";

import { useSession, signOut } from "next-auth/react";
import { LayoutDashboard, Users, Bell, Search, LogOut, PhoneCall, Database, Settings, Phone, Calendar, User, Download, PhoneOutgoing, Activity, MapPin, MessageSquare, AlertCircle, Clock, TrendingUp, FileText, Headphones, UserCheck, BarChart3, UserCog, Network, ClipboardList, Map, Gauge, Trophy, GraduationCap, Share2, Newspaper } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import Heartbeat from "@/components/Heartbeat";
import NotificationBell from "@/components/NotificationBell";
import { isAdmin, isSupervisorRole, roleLabel, normalizeRole, ROLES } from "@/lib/permissions";

async function handleSignOut() {
  try {
    await fetch("/api/logout-mark", { method: "POST" });
  } catch {}
  signOut();
}

export default function DashboardLayout({ children }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();

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
      { name: "Workers", href: "/dashboard/admin/workers", icon: UserCog },
      { name: "Teams", href: "/dashboard/admin/teams", icon: Network },
      { name: "Contacts", href: "/dashboard/admin/contacts", icon: UserCheck },
      { name: "Call Records", href: "/dashboard/admin/calls", icon: Database },
      { name: "Tasks", href: "/dashboard/tasks", icon: ClipboardList },
      { name: "Complaints", href: "/dashboard/admin/complaints", icon: MessageSquare },
      { name: "Analytics", href: "/dashboard/analytics", icon: BarChart3 },
      { name: "Map", href: "/dashboard/map", icon: Map },
      { name: "Strength", href: "/dashboard/strength", icon: Gauge },
      { name: "Rankings", href: "/dashboard/rankings", icon: Trophy },
      { name: "Social War Room", href: "/dashboard/social", icon: Share2 },
      { name: "Social Command", href: "/dashboard/social-management", icon: Share2 },
      { name: "Media", href: "/dashboard/media", icon: Newspaper },
      { name: "Reports", href: "/dashboard/reports", icon: FileText },
      { name: "Master Data", href: "/dashboard/admin/settings", icon: Settings },
      { name: "Users", href: "/dashboard/admin/users", icon: Users },
    ],
    [ROLES.STATE_ADMIN]: [
      // Same as super_admin except no Users management
      { name: "Dashboard", href: "/dashboard/admin", icon: LayoutDashboard },
      { name: "Workers", href: "/dashboard/admin/workers", icon: UserCog },
      { name: "Teams", href: "/dashboard/admin/teams", icon: Network },
      { name: "Contacts", href: "/dashboard/admin/contacts", icon: UserCheck },
      { name: "Call Records", href: "/dashboard/admin/calls", icon: Database },
      { name: "Tasks", href: "/dashboard/tasks", icon: ClipboardList },
      { name: "Complaints", href: "/dashboard/admin/complaints", icon: MessageSquare },
      { name: "Analytics", href: "/dashboard/analytics", icon: BarChart3 },
      { name: "Map", href: "/dashboard/map", icon: Map },
      { name: "Strength", href: "/dashboard/strength", icon: Gauge },
      { name: "Rankings", href: "/dashboard/rankings", icon: Trophy },
      { name: "Social War Room", href: "/dashboard/social", icon: Share2 },
      { name: "Social Command", href: "/dashboard/social-management", icon: Share2 },
      { name: "Media", href: "/dashboard/media", icon: Newspaper },
      { name: "Reports", href: "/dashboard/reports", icon: FileText },
      { name: "Master Data", href: "/dashboard/admin/settings", icon: Settings },
    ],
    [ROLES.ZONE_ADMIN]: [
      // Zone admins manage zone operations; no Users, Master Data, or Social Command (state-level)
      { name: "Dashboard", href: "/dashboard/admin", icon: LayoutDashboard },
      { name: "Workers", href: "/dashboard/admin/workers", icon: UserCog },
      { name: "Teams", href: "/dashboard/admin/teams", icon: Network },
      { name: "Contacts", href: "/dashboard/admin/contacts", icon: UserCheck },
      { name: "Call Records", href: "/dashboard/admin/calls", icon: Database },
      { name: "Tasks", href: "/dashboard/tasks", icon: ClipboardList },
      { name: "Complaints", href: "/dashboard/admin/complaints", icon: MessageSquare },
      { name: "Analytics", href: "/dashboard/analytics", icon: BarChart3 },
      { name: "Map", href: "/dashboard/map", icon: Map },
      { name: "Strength", href: "/dashboard/strength", icon: Gauge },
      { name: "Rankings", href: "/dashboard/rankings", icon: Trophy },
      { name: "Reports", href: "/dashboard/reports", icon: FileText },
    ],
    [ROLES.DISTRICT_ADMIN]: [
      // District admin: focused on field ops within one district
      { name: "Dashboard", href: "/dashboard/admin", icon: LayoutDashboard },
      { name: "Workers", href: "/dashboard/admin/workers", icon: UserCog },
      { name: "Teams", href: "/dashboard/admin/teams", icon: Network },
      { name: "Contacts", href: "/dashboard/admin/contacts", icon: UserCheck },
      { name: "Call Records", href: "/dashboard/admin/calls", icon: Database },
      { name: "Tasks", href: "/dashboard/tasks", icon: ClipboardList },
      { name: "Complaints", href: "/dashboard/admin/complaints", icon: MessageSquare },
      { name: "Rankings", href: "/dashboard/rankings", icon: Trophy },
      { name: "Reports", href: "/dashboard/reports", icon: FileText },
    ],
    [ROLES.ASSEMBLY_ADMIN]: [
      // Assembly admin: very narrow — booth & ward management
      { name: "Dashboard", href: "/dashboard/admin", icon: LayoutDashboard },
      { name: "Workers", href: "/dashboard/admin/workers", icon: UserCog },
      { name: "Teams", href: "/dashboard/admin/teams", icon: Network },
      { name: "Contacts", href: "/dashboard/admin/contacts", icon: UserCheck },
      { name: "Tasks", href: "/dashboard/tasks", icon: ClipboardList },
      { name: "Complaints", href: "/dashboard/admin/complaints", icon: MessageSquare },
    ],
  };

  let navItems;
  if (isUserAdmin) {
    navItems = ADMIN_MENUS[canonical] || ADMIN_MENUS[ROLES.SUPER_ADMIN];
  } else if (isSupervisor) {
    navItems = [
      { name: "Overview", href: "/dashboard/supervisor", icon: LayoutDashboard },
      { name: "Analytics", href: "/dashboard/analytics", icon: BarChart3 },
      { name: "Caller Performance", href: "/dashboard/supervisor/callers", icon: TrendingUp },
      { name: "Live Status", href: "/dashboard/supervisor/live", icon: Activity },
      { name: "Workers", href: "/dashboard/admin/workers", icon: UserCog },
      { name: "Area Reports", href: "/dashboard/supervisor/areas", icon: MapPin },
      { name: "Map", href: "/dashboard/map", icon: Map },
      { name: "Strength", href: "/dashboard/strength", icon: Gauge },
      { name: "Rankings", href: "/dashboard/rankings", icon: Trophy },
      { name: "Tasks", href: "/dashboard/tasks", icon: ClipboardList },
      { name: "Sentiment", href: "/dashboard/supervisor/sentiment", icon: MessageSquare },
      { name: "Follow-Ups", href: "/dashboard/supervisor/follow-ups", icon: PhoneCall },
      { name: "Remarks", href: "/dashboard/supervisor/remarks", icon: FileText },
      { name: "Attendance", href: "/dashboard/supervisor/attendance", icon: Clock },
      { name: "Media", href: "/dashboard/media", icon: Newspaper },
      { name: "Reports", href: "/dashboard/reports", icon: FileText },
      { name: "Alerts", href: "/dashboard/supervisor/alerts", icon: AlertCircle },
    ];
  } else if (canonical === ROLES.WORKER) {
    // Workers: org members on the ground. No calling UI.
    navItems = [
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { name: "My Tasks", href: "/dashboard/tasks", icon: ClipboardList },
    ];
  } else {
    // Caller (and legacy 'user'/'agent') — the calling workspace
    navItems = [
      { name: "My Workspace", href: "/dashboard/workspace", icon: Headphones },
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { name: "Log a Call", href: "/dashboard/calls/new", icon: PhoneCall },
      { name: "My Calls", href: "/dashboard/calls", icon: Database },
      { name: "My Tasks", href: "/dashboard/tasks", icon: ClipboardList },
    ];
  }

  return (
    <div className="h-screen w-full flex overflow-hidden font-sans bg-[#f4f6f8]">
      <Heartbeat />

      {/* Sidebar */}
      <aside className="w-[260px] flex-shrink-0 flex flex-col h-full bg-[#0B3A82] text-white">
        {/* Logo */}
        <div className="flex flex-col items-center py-6 border-b border-white/10">
          <img src="/aap_logo.jpg" alt="AAP Logo" className="w-20 h-20 object-contain mb-2 rounded-full border-2 border-white/20 bg-white" />
          <div className="text-base mt-2 font-medium">Chhattisgarh</div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-6 py-3 transition-all ${
                  isActive 
                    ? "bg-[#1d4c94] text-white border-l-4 border-white font-semibold" 
                    : "text-blue-100 hover:text-white hover:bg-white/5 border-l-4 border-transparent font-medium"
                }`}
              >
                <Icon size={20} className={isActive ? "text-white" : "text-blue-200"} />
                <span className="flex-1">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom Area */}
        <div className="p-4 mt-auto">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-4 py-2.5 rounded-md text-blue-200 hover:text-white hover:bg-white/10 w-full transition-all text-sm"
          >
            <LogOut size={18} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        
        {/* Header */}
        <header className="bg-white h-[100px] flex items-center justify-between px-8 border-b border-gray-200 shrink-0 shadow-sm z-10">
          {/* Header Left - Organization Info */}
          <div className="flex items-center gap-5">
            <div className="w-[100px] h-[100px] flex items-center justify-center shrink-0 -mt-2">
              <img 
                src="/kejriwal_new.png" 
                alt="Arvind Kejriwal" 
                className="w-full h-full object-contain scale-125 mix-blend-multiply drop-shadow-sm" 
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.parentElement.innerHTML = '<span class="text-gray-400 font-bold text-xl">AK</span>';
                }} 
              />
            </div>
            <div className="flex flex-col justify-center">
              <h1 className="text-[28px] font-bold text-[#0B3A82] leading-tight">Aam Aadmi Party, Chhattisgarh</h1>
              <p className="text-[15px] text-gray-600 mt-0.5 font-medium">Honest Politics | Better Chhattisgarh</p>
            </div>
          </div>

          {/* Header Right - User & Notifications */}
          <div className="flex items-center gap-4">
            {(isUserAdmin || isSupervisor) && <NotificationBell />}

            <div className="flex items-center gap-3 pl-4">
              <div className="w-10 h-10 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0B3A82] shrink-0">
                <User size={20} />
              </div>
              <div className="text-left flex flex-col justify-center mr-2">
                <div className="text-sm font-bold text-gray-900 leading-tight">
                  {session.user.name}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {roleLabel(role)}
                </div>
              </div>
              <span className="text-gray-400">▼</span>
            </div>
          </div>
        </header>

        {/* Scrollable Main Content */}
        <main className="flex-1 overflow-y-auto p-8 relative">
          {children}
        </main>
        
        {/* Footer */}
        <footer className="bg-[#0B3A82] text-white py-3 px-8 text-[13px] flex justify-between items-center shrink-0">
          <div className="font-medium text-blue-100">Aam Aadmi Party, Chhattisgarh | Honest Politics, Better Chhattisgarh</div>
          <div className="text-blue-200">© {new Date().getFullYear()} Aam Aadmi Party Chhattisgarh</div>
        </footer>

      </div>
      
    </div>
  );
}
